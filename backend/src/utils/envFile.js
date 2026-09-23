'use strict';

const fs   = require('fs');
const path = require('path');

// =============================================================================
// envFile.js — Escritura atómica de archivos .env.
//
// POR QUE EXISTE:
//   backend/.env guarda MASTER_KEY, JWT_SECRET y DB_PASSWORD. Tres puntos del
//   codigo lo reescriben (el wizard de instalacion, la rotacion de Master Key y
//   el guardado de cors_origin) y los tres hacian lo mismo: leer, sustituir la
//   linea y `fs.writeFileSync` sobre el archivo real.
//
//   writeFileSync TRUNCA antes de escribir. Un corte de corriente, un OOM kill o
//   un disco lleno a mitad de la escritura dejan el .env vacio o cortado. Si la
//   linea perdida es MASTER_KEY, TODAS las credenciales cifradas quedan
//   irrecuperables: la clave solo vive en ese archivo y en process.env, y el
//   proceso que la tenia en memoria es justo el que acaba de morir.
//
//   Aqui se escribe primero un temporal en el MISMO directorio, se fuerza a
//   disco con fsync y solo entonces se hace rename() sobre el destino. rename()
//   dentro de un sistema de archivos es atomico: cualquier lector ve el
//   contenido viejo o el nuevo, nunca uno a medias, y un corte en cualquier
//   instante deja intacto el .env anterior.
//
//   El rename cierra ademas la ventana entre procesos (dos instancias en
//   cluster, o un operador editando el archivo durante una rotacion). Dentro de
//   un solo proceso Node no habia carrera: las tres funciones eran sincronas de
//   principio a fin y no se podian intercalar.
//
// PERMISOS: el temporal se crea con el modo del .env existente (0600 si es
// nuevo). Sin esto el rename se llevaria por delante unos permisos restrictivos
// y dejaria los secretos con el umask del proceso.
// =============================================================================

// Una clave de entorno valida. Nada que venga de fuera deberia llegar aqui como
// nombre de variable, pero se comprueba igual: es la mitad de la linea.
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Lo que parte una linea del .env en dos.
const NEWLINE_RE = /[\r\n]/;

/**
 * Devuelve el valor tal como debe escribirse para que dotenv lo lea igual.
 *
 * Sin comillas, dotenv corta el valor en el primer '#' (lo toma por comentario),
 * recorta los espacios de los extremos y quita unas comillas que lo envuelvan.
 * Una contrasena de BD como "abc#def" se leia como "abc": la instalacion
 * terminaba bien y el primer login fallaba con 28P01. En la Master Key seria
 * peor: tras reiniciar, ninguna credencial se podria descifrar.
 *
 * Entre comillas simples o backticks dotenv no interpreta nada (las dobles si:
 * expanden \n), asi que se usa la primera que no aparezca dentro del valor.
 *
 * @param {string} value
 * @returns {string|null} Valor listo para escribir, o null si no hay forma.
 */
function formatEnvValue(value) {
  const needsQuotes = value !== value.trim() || value.includes('#') || /^['"`]/.test(value);
  if (!needsQuotes) return value;
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('`')) return `\`${value}\``;
  return null;
}

/**
 * Rechaza los valores que romperian el formato "una variable por linea".
 *
 * ESTO NO ES COSMETICO. Tres de los valores que se escriben aqui vienen de una
 * peticion HTTP: cors_origin (PUT /api/system/settings), la clave nueva de
 * POST /api/security/rotate-key, y la Master Key y la contrasena de BD del
 * wizard. Un salto de linea dentro de cualquiera de ellos parte la linea en dos
 * y la segunda mitad ES UNA ASIGNACION MAS, con el mismo peso que las demas:
 *
 *   cors_origin = "http://x/\nJWT_SECRET=conocido"
 *     -> CORS_ORIGIN=http://x/
 *        JWT_SECRET=conocido
 *
 * Y la validacion de cors_origin con `new URL()` NO lo detiene: el parser
 * WHATWG descarta los saltos de linea antes de analizar la cadena, asi que la
 * URL se da por buena mientras que lo que se escribe es el texto crudo.
 * estimateEntropy() tampoco los ve al validar una Master Key.
 *
 * El riesgo no necesita un atacante: un salto de linea pegado sin querer dentro
 * de la Master Key parte la linea MASTER_KEY= y, al siguiente reinicio, no se
 * descifra ni una credencial. Es justo la perdida que la escritura atomica de
 * este modulo existe para evitar.
 *
 * isEnvSafeValue() es la misma comprobacion como predicado, para que quien
 * recibe el valor por HTTP pueda rechazarlo con un 400 claro ANTES de empezar
 * a trabajar, en vez de descubrirlo con una excepcion a mitad de la operacion.
 *
 * @param {string} key
 * @param {string} value
 * @throws {Error} con code 'ENV_VALUE_INVALID' si la pareja no es escribible.
 */
function isEnvSafeValue(value) {
  const str = String(value);
  return !NEWLINE_RE.test(str) && formatEnvValue(str) !== null;
}

function assertWritablePair(key, value) {
  if (!ENV_KEY_RE.test(key)) {
    const err = new Error(`Nombre de variable de entorno no valido: "${key}".`);
    err.code = 'ENV_VALUE_INVALID';
    throw err;
  }
  if (!isEnvSafeValue(value)) {
    const err = new Error(
      `El valor de ${key} no puede contener saltos de linea, ni comilla simple y backtick ` +
      'a la vez cuando necesita comillas: romperia el formato del archivo .env.'
    );
    err.code = 'ENV_VALUE_INVALID';
    throw err;
  }
}

/**
 * Aplica las sustituciones sobre el contenido de un .env.
 *
 * Respeta comentarios y lineas sin '=' tal cual. Las claves que no existian se
 * anaden al final.
 *
 * @param {string} content - Contenido actual del archivo ('' si no existe).
 * @param {Object<string,string>} updates - Pares clave/valor a fijar.
 * @param {string} [sectionComment] - Comentario que precede a las claves nuevas.
 * @returns {string} Contenido resultante.
 * @throws {Error} code 'ENV_VALUE_INVALID' si alguna pareja no es escribible.
 */
function applyUpdates(content, updates, sectionComment) {
  const pending = new Map(Object.entries(updates).map(([k, v]) => [k, String(v)]));

  // Antes de tocar nada: o se puede escribir todo, o no se escribe nada.
  for (const [k, v] of pending) assertWritablePair(k, v);
  for (const [k, v] of pending) pending.set(k, formatEnvValue(v));

  // Un archivo vacio da [''] al partir por '\n', y eso sembraria una linea en
  // blanco al principio del .env recien creado.
  const lines = (content === '' ? [] : content.split('\n')).map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || !trimmed.includes('=')) return line;

    const key = trimmed.split('=')[0].trim();
    if (!pending.has(key)) return line;

    const value = pending.get(key);
    pending.delete(key);
    return `${key}=${value}`;
  });

  if (pending.size > 0) {
    const entries = [...pending].map(([k, v]) => `${k}=${v}`);
    if (sectionComment) {
      // El separador en blanco solo tiene sentido si ya habia contenido.
      if (lines.length > 0) lines.push('');
      lines.push(sectionComment, ...entries);
    } else {
      lines.push(...entries);
    }
  }

  return lines.join('\n');
}

/**
 * Reescribe un archivo .env de forma atomica, fijando las claves indicadas.
 *
 * @param {string} envPath - Ruta absoluta del .env.
 * @param {Object<string,string>} updates - Pares clave/valor a fijar.
 * @param {object} [options]
 * @param {number} [options.mode] - Fuerza el modo del archivo (ej: 0o600).
 *        Por defecto conserva el del archivo existente, o 0600 si es nuevo.
 * @param {string} [options.sectionComment] - Comentario para las claves nuevas.
 */
function updateEnvFile(envPath, updates, options = {}) {
  let existing = '';
  try {
    existing = fs.readFileSync(envPath, 'utf8');
  } catch { /* no existe todavia: se crea desde cero */ }

  const updated = applyUpdates(existing, updates, options.sectionComment);

  // Modo destino: el que ya tiene el archivo, o 0600 para uno nuevo. Un .env con
  // secretos nunca debe acabar mas abierto de lo que estaba.
  let mode = 0o600;
  if (options.mode !== undefined) {
    mode = options.mode;
  } else {
    try { mode = fs.statSync(envPath).mode & 0o777; } catch { /* nuevo: 0600 */ }
  }

  // El temporal va en el mismo directorio para que rename() sea atomico: entre
  // sistemas de archivos distintos rename() degrada a copiar y borrar.
  const tmpPath = path.join(
    path.dirname(envPath),
    `.${path.basename(envPath)}.tmp-${process.pid}-${Date.now()}`
  );

  try {
    const fd = fs.openSync(tmpPath, 'wx', mode);
    try {
      fs.writeFileSync(fd, updated, 'utf8');
      // fsync antes del rename: sin el, el rename puede llegar al disco antes que
      // el contenido y un corte dejaria el .env correctamente renombrado y vacio.
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }

    // openSync aplica el umask al modo; chmod lo fija sin ambiguedad.
    try { fs.chmodSync(tmpPath, mode); } catch { /* Windows: chmod no aplica */ }

    fs.renameSync(tmpPath, envPath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* puede no haberse creado */ }
    throw err;
  }
}

module.exports = { updateEnvFile, applyUpdates, assertWritablePair, isEnvSafeValue };
