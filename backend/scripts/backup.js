'use strict';

// =============================================================================
// backup.js — Copia de seguridad de la base, con retención y verificación.
//
// Uso (desde la carpeta backend/):
//   npm run backup                → hace la copia y aplica la retención
//   npm run backup -- --dry       → dice qué haría, sin escribir ni borrar nada
//   npm run backup -- --verify    → además RESTAURA la copia recién hecha en una
//                                   base temporal y comprueba que se descifra
//   npm run backup -- --list      → lista las copias que hay ahora mismo
//
// POR QUÉ EXISTE
// Hasta el ensayo de recuperación del 2026-09-19 no había ninguna copia
// automática ni procedimiento escrito. Para un gestor de credenciales, perder la
// base es tan grave como una filtración: las contraseñas de la infraestructura
// no están en ningún otro sitio.
//
// LO QUE ESTE SCRIPT **NO** GUARDA: la MASTER_KEY.
// Es deliberado. La clave vive en el .env y el volcado solo lleva las
// credenciales CIFRADAS. Guardar las dos cosas juntas anularía el cifrado: quien
// robase el disco de copias se lo llevaría todo en claro. La otra cara es que
// una copia sin la clave NO se puede descifrar: la clave se custodia aparte, y
// si se pierde no hay atajo. El fichero .meta.json que acompaña a cada copia
// anota el hash de la clave activa para saber CUÁL abre esa copia, sin revelarla.
//
// DOS TRAMPAS QUE ESTE SCRIPT EVITA (vistas en el ensayo, deploy/RECUPERACION.md):
//   R1 — Un pg_dump de versión distinta a la del servidor escribe instrucciones
//        que el servidor no entiende y la restauración aborta. Aquí se comprueba
//        ANTES de hacer la copia, porque si no el fallo aparece el día de la
//        emergencia y no el día de la copia.
//   R2 — Restaurar conectado como postgres deja las tablas de postgres y la
//        aplicación sin poder leer nada. --verify restaura como el rol de la
//        aplicación, que es el procedimiento bueno.
//
// PENSADO PARA CRON / TAREA PROGRAMADA. Escribe una línea de resumen y sale con
// código distinto de 0 si algo falló, para que el programador de tareas lo note.
// =============================================================================

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const fs = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { Client } = require('pg');

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const VERIFY = args.includes('--verify');
const LIST = args.includes('--list');
const FORCE = args.includes('--force');

// Por defecto, FUERA del repositorio (antes era <repo>/backups). El .gitignore
// impedía commitearlo, pero una copia lleva los hashes de contraseña de todos los
// usuarios y no tiene por qué vivir en un árbol de código que se copia, se
// comparte o se abre con el editor.
const DIR = process.env.BACKUP_DIR || path.resolve(__dirname, '../../../icm-backups');
const RAIZ_REPO = path.resolve(__dirname, '../..');
const PREFIJO = 'icm-';

// Retención de tipo "abuelo-padre-hijo": muchas copias recientes y cada vez
// menos según envejecen. Con los valores por defecto se guardan unas 23 copias y
// se puede volver a cualquier día de la última semana, a cualquier semana del
// último mes y a cualquier mes del último año.
// Antes esto era un Number() a secas. BACKUP_KEEP_DAILY=diario daba NaN, la
// comparación `vistas.size <= NaN` era siempre falsa, ninguna regla salvaba nada
// y la retención dejaba UNA copia: el archivo entero borrado por una errata, sin
// aviso y sin vuelta atrás. Ahora se valida y se para antes.
function entero(nombre, valor, porDefecto) {
  if (valor === undefined || String(valor).trim() === '') return porDefecto;
  const n = Number(String(valor).trim());
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${nombre}=${valor} no vale: tiene que ser un número entero de copias (0 o más). `
      + 'Con un valor así la retención borraría casi todo el archivo, así que no se hace nada.');
  }
  return n;
}

/** Los valores de retención del .env, ya validados. */
function leerRetencion() {
  const c = {
    diarias:   entero('BACKUP_KEEP_DAILY',   process.env.BACKUP_KEEP_DAILY,   7),
    semanales: entero('BACKUP_KEEP_WEEKLY',  process.env.BACKUP_KEEP_WEEKLY,  4),
    mensuales: entero('BACKUP_KEEP_MONTHLY', process.env.BACKUP_KEEP_MONTHLY, 12),
  };
  if (c.diarias + c.semanales + c.mensuales === 0) {
    throw new Error('BACKUP_KEEP_DAILY, BACKUP_KEEP_WEEKLY y BACKUP_KEEP_MONTHLY valen 0 las tres: '
      + 'eso dejaría una sola copia. Deja al menos una regla con valor.');
  }
  return c;
}

const CONEXION = {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
};

// Solo para --verify: crear y borrar la base temporal exige un rol con CREATEDB,
// y el de la aplicación no lo tiene ni debe tenerlo. Estas credenciales NO hacen
// falta para copiar; se pasan al vuelo en la ejecución que verifica
// (BACKUP_ADMIN_USER=postgres BACKUP_ADMIN_PASSWORD=... npm run backup -- --verify)
// mejor que dejarlas escritas en el .env de la aplicación.
const ADMIN_VERIFICA = {
  ...CONEXION,
  user: process.env.BACKUP_ADMIN_USER || CONEXION.user,
  password: process.env.BACKUP_ADMIN_PASSWORD || CONEXION.password,
};

// -----------------------------------------------------------------------------
// Utilidades
// -----------------------------------------------------------------------------

const log = (m) => console.log(m);
const mb = (bytes) => `${(bytes / 1048576).toFixed(2)} MB`;

/** Marca de tiempo local ordenable: 2026-09-19_2143. */
function sello(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

/** Localiza los ejecutables de PostgreSQL: PG_BIN si está, si no el PATH. */
function ejecutable(nombre) {
  const exe = process.platform === 'win32' ? `${nombre}.exe` : nombre;
  if (process.env.PG_BIN) return path.join(process.env.PG_BIN, exe);
  return exe;
}

/**
 * Un identificador SQL entre comillas. Antes el nombre de la base temporal y el
 * del rol se pegaban crudos al CREATE DATABASE: con icm_user funciona, pero un
 * rol con mayúsculas o guiones rompía la orden. No es inyección
 * —el valor sale del .env, no de la red—, pero se arregla con dos comillas.
 */
function ident(nombre) {
  return `"${String(nombre).replace(/"/g, '""')}"`;
}

/** Versión mayor de un "pg_dump (PostgreSQL) 18.3" o de un "16.8". */
function versionMayor(texto) {
  const m = String(texto).match(/(\d+)\.\d+/);
  return m ? Number(m[1]) : null;
}

// -----------------------------------------------------------------------------
// Inventario de copias
// -----------------------------------------------------------------------------

/** Las copias del directorio, de la más nueva a la más vieja. */
function inventario() {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR)
    .filter((f) => f.startsWith(PREFIJO) && f.endsWith('.sql.gz'))
    .map((f) => {
      const fecha = new Date(fs.statSync(path.join(DIR, f)).mtime);
      return { fichero: f, ruta: path.join(DIR, f), fecha, bytes: fs.statSync(path.join(DIR, f)).size };
    })
    .sort((a, b) => b.fecha - a.fecha);
}

/** Lunes de la semana de una fecha, como clave 'AAAA-MM-DD'. */
function claveSemana(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));   // lunes
  return x.toISOString().slice(0, 10);
}
const claveDia = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0, 10);
const claveMes = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/**
 * Decide qué copias sobran. Se conservan, de las más nuevas a las más viejas:
 * la última de cada uno de los últimos N días, la última de cada una de las
 * últimas N semanas y la última de cada uno de los últimos N meses. Lo que no
 * quede elegido por ninguna de las tres reglas, sobra.
 *
 * Si algo va mal y solo queda UNA copia, no se borra nunca: es preferible pasarse
 * de guardar que quedarse sin nada.
 */
function seleccionarParaBorrar(copias, conservar = leerRetencion()) {
  const salvadas = new Set();
  for (const [clave, cuantas] of [[claveDia, conservar.diarias], [claveSemana, conservar.semanales], [claveMes, conservar.mensuales]]) {
    const vistas = new Set();
    for (const c of copias) {                 // ya vienen de más nueva a más vieja
      const k = clave(c.fecha);
      if (vistas.has(k)) continue;
      vistas.add(k);
      if (vistas.size <= cuantas) salvadas.add(c.fichero);
    }
  }
  const sobran = copias.filter((c) => !salvadas.has(c.fichero));
  return sobran.length === copias.length ? sobran.slice(1) : sobran;
}

// -----------------------------------------------------------------------------
// Comprobaciones previas
// -----------------------------------------------------------------------------

/**
 * Compara la versión del cliente pg_dump con la del servidor (trampa R1).
 * Un pg_dump más nuevo que el servidor genera un volcado que ese servidor NO
 * puede restaurar, y no hay forma de enterarse hasta que hace falta.
 */
async function comprobarVersiones() {
  const cli = spawnSync(ejecutable('pg_dump'), ['--version'], { encoding: 'utf8' });
  if (cli.error) {
    throw new Error(`No se encuentra pg_dump. Instálalo o indica su carpeta en PG_BIN del .env. (${cli.error.message})`);
  }
  const mayorCliente = versionMayor(cli.stdout);

  const c = new Client(CONEXION);
  await c.connect();
  const { rows } = await c.query('SHOW server_version');
  await c.end();
  const mayorServidor = versionMayor(rows[0].server_version);

  log(`  pg_dump ${mayorCliente} · servidor PostgreSQL ${mayorServidor}`);
  if (mayorCliente !== mayorServidor) {
    const aviso = `Las herramientas son de PostgreSQL ${mayorCliente} y el servidor es ${mayorServidor}. `
      + 'Un volcado hecho así puede no restaurarse en este servidor (ver R1 en deploy/RECUPERACION.md). '
      + 'Instala el cliente de la misma versión, o indica su carpeta en PG_BIN.';
    if (!FORCE) throw new Error(`${aviso}\n  Para hacer la copia de todos modos: npm run backup -- --force`);
    log(`  AVISO: ${aviso}`);
    log('  Con --force se quitan del volcado los ajustes que este servidor no reconoce, para que siga siendo restaurable.');
  }
  return { mayorCliente, mayorServidor, sanear: mayorCliente !== mayorServidor };
}

const RECUENTOS = ['usuarios', 'credenciales', 'auditoria', 'ajustes'];

/**
 * El volcado de pg_dump es una foto coherente tomada en algún instante ENTRE la
 * radiografía de antes y la de después. Así que lo restaurado tiene que caer
 * entre las dos, no coincidir con una: comparando contra la lectura previa
 * bastaba una fila de auditoría —y se escribe una con casi cualquier acción—
 * para que --verify fallara en una base viva y la tarea programada avisara de un
 * problema que no existía.
 */
function intervalo(antes, despues) {
  const r = {};
  for (const k of RECUENTOS) r[k] = { min: Math.min(antes[k], despues[k]), max: Math.max(antes[k], despues[k]) };
  return r;
}

/** Recuentos y clave activa, para poder comprobar después que la copia está entera. */
async function radiografia(base = CONEXION.database) {
  const c = new Client({ ...CONEXION, database: base });
  await c.connect();
  const { rows } = await c.query(`
    SELECT (SELECT COUNT(*)::int FROM sch_system.tbl_users)           AS usuarios,
           (SELECT COUNT(*)::int FROM sch_secret.tbl_credentials)     AS credenciales,
           (SELECT COUNT(*)::int FROM sch_audit.tbl_audit_log)        AS auditoria,
           (SELECT COUNT(*)::int FROM sch_system.tbl_system_settings) AS ajustes`);
  const clave = await c.query('SELECT key_alias, key_hash FROM sch_secret.tbl_master_config WHERE is_active = true');
  await c.end();
  return { ...rows[0], clave: clave.rows[0] || null };
}

// -----------------------------------------------------------------------------
// La copia
// -----------------------------------------------------------------------------

// Ajustes que un pg_dump más nuevo escribe en la cabecera y que un servidor más
// antiguo no reconoce. Todos valen su valor por defecto ('sin límite'), así que
// quitarlos no cambia lo que se restaura: solo evita que la restauración aborte
// en la línea 13. Se usa ÚNICAMENTE con --force, cuando ya se ha avisado de que
// las versiones no casan; lo correcto sigue siendo usar el cliente que toca.
const SETS_NO_PORTABLES = /^SET\s+(transaction_timeout)\s*=/;

// Principio y fin de un bloque de datos. Dentro de un COPY, una línea es el
// contenido de una fila y no se toca jamás; el terminador es un \. solo.
const ABRE_DATOS = /^COPY .* FROM stdin;/;
const CIERRA_DATOS = '\\.';

/**
 * Quita esas líneas del volcado, respetando los saltos de línea.
 *
 * Nunca dentro de un bloque COPY. Antes filtraba el flujo ENTERO, datos
 * incluidos: un valor de texto cuya línea empezara por "SET transaction_timeout ="
 * habría desaparecido del volcado sin que nadie se enterase, y la restauración
 * habría fallado o, peor, desplazado columnas. No era alcanzable —la única tabla
 * cuya primera columna es texto es tbl_system_settings, y la aplicación no
 * inserta claves nuevas—, pero depender de eso es frágil.
 *
 * Se mira el bloque de datos y no "dónde acaba la cabecera": pg_dump 18 mete un
 * \restrict entre los comentarios y los SET, y un saneador que se fiara de la
 * forma de la cabecera se apagaría ahí, dejaría pasar el SET transaction_timeout
 * y la restauración volvería a abortar. Probado: eso es justo lo que pasó.
 */
function saneador() {
  let resto = '';
  let enDatos = false;
  const filtrar = (linea) => {
    if (enDatos) {
      if (linea === CIERRA_DATOS) enDatos = false;
      return false;
    }
    if (ABRE_DATOS.test(linea)) { enDatos = true; return false; }
    return SETS_NO_PORTABLES.test(linea);
  };
  return new Transform({
    transform(trozo, _enc, cb) {
      const lineas = (resto + trozo.toString('utf8')).split('\n');
      resto = lineas.pop();
      cb(null, lineas.filter((l) => !filtrar(l)).map((l) => `${l}\n`).join(''));
    },
    flush(cb) { cb(null, filtrar(resto) ? '' : resto); },
  });
}

/**
 * Crea el directorio de copias y le quita el acceso a todo el mundo menos a
 * quien ejecuta esto, al SISTEMA y a los administradores.
 *
 * Los ficheros se escriben con mode 0600, pero **en Windows ese modo no hace
 * nada**: los permisos reales son los ACL que la carpeta hereda. Es decir, hasta
 * ahora la protección de un volcado con los hashes de contraseña de todos los
 * usuarios era la que tuviera la carpeta padre. Si icacls o chmod
 * fallan no se aborta la copia —tener copia importa más—, pero se avisa.
 */
function prepararDirectorio() {
  const nuevo = !fs.existsSync(DIR);
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });

  if (path.resolve(DIR) === RAIZ_REPO || path.resolve(DIR).startsWith(RAIZ_REPO + path.sep)) {
    log('  AVISO: el destino está dentro del repositorio. Las copias llevan los hashes de');
    log('         contraseña de todos los usuarios: apunta BACKUP_DIR fuera del árbol de código.');
  }
  if (!nuevo) return;

  if (process.platform === 'win32') {
    const quien = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}` : String(process.env.USERNAME);
    const r = spawnSync('icacls', [DIR, '/inheritance:r',
      '/grant:r', '*S-1-5-18:(OI)(CI)F',        // SISTEMA
      '/grant:r', '*S-1-5-32-544:(OI)(CI)F',    // Administradores
      '/grant:r', `${quien}:(OI)(CI)F`], { encoding: 'utf8' });
    if (r.error || r.status !== 0) {
      log(`  AVISO: no se pudieron restringir los permisos de ${DIR} (${(r.stderr || (r.error && r.error.message) || '').trim()}).`);
      log('         Restríngelos a mano: las copias son material sensible.');
    } else {
      log(`  permisos: solo ${quien}, SISTEMA y administradores`);
    }
  } else {
    try {
      fs.chmodSync(DIR, 0o700);
      log('  permisos: 0700, solo el usuario que ejecuta la copia');
    } catch (e) {
      log(`  AVISO: no se pudo aplicar 0700 a ${DIR} (${e.message}). Restríngelo a mano.`);
    }
  }
}

/**
 * Borra los volcados a medias de ejecuciones anteriores que fallaron antes de
 * que existiera esta limpieza, o que dejó un corte de luz. Solo los de más
 * de un dia, para no pisar una copia que este corriendo ahora mismo.
 */
function limpiarParciales() {
  if (!fs.existsSync(DIR)) return 0;
  const limite = Date.now() - 24 * 60 * 60 * 1000;
  let n = 0;
  for (const f of fs.readdirSync(DIR)) {
    if (!f.startsWith(PREFIJO) || !f.endsWith('.parcial')) continue;
    const ruta = path.join(DIR, f);
    if (fs.statSync(ruta).mtime.getTime() < limite) { fs.rmSync(ruta, { force: true }); n += 1; }
  }
  return n;
}

async function copiar({ sanear = false } = {}) {
  // Dos copias en el mismo minuto no deben pisarse: la segunda lleva segundos.
  let fichero = `${PREFIJO}${sello()}.sql.gz`;
  if (fs.existsSync(path.join(DIR, fichero))) {
    fichero = `${PREFIJO}${sello()}${String(new Date().getSeconds()).padStart(2, '0')}.sql.gz`;
  }
  const destino = path.join(DIR, fichero);
  const parcial = `${destino}.parcial`;   // nombre definitivo solo si termina bien

  const args = ['-h', CONEXION.host, '-p', String(CONEXION.port), '-U', CONEXION.user,
    '-d', CONEXION.database, '--no-owner', '--no-privileges'];
  const proc = spawn(ejecutable('pg_dump'), args, {
    env: { ...process.env, PGPASSWORD: CONEXION.password },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let errores = '';
  proc.stderr.on('data', (d) => { errores += d.toString(); });

  const hash = crypto.createHash('sha256');
  const salida = fs.createWriteStream(parcial, { mode: 0o600 });
  const gz = zlib.createGzip({ level: 9 });
  // El hash es de lo que REALMENTE se guarda, ya saneado, para que sirva de
  // comprobación de integridad del fichero.
  const testigo = new Transform({ transform(t, _e, cb) { hash.update(t); cb(null, t); } });

  const terminado = new Promise((resolve, reject) => {
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`pg_dump terminó con código ${code}: ${errores.trim()}`))));
  });

  const tuberia = sanear
    ? pipeline(proc.stdout, saneador(), testigo, gz, salida)
    : pipeline(proc.stdout, testigo, gz, salida);
  try {
    await Promise.all([tuberia, terminado]);
  } catch (e) {
    // Un volcado a medias no sirve para nada y lleva datos reales. Si se queda,
    // nadie lo borra nunca: inventario() solo mira los .sql.gz, así que la
    // retención no lo ve.
    fs.rmSync(parcial, { force: true });
    throw e;
  }
  fs.renameSync(parcial, destino);
  return { fichero, destino, bytes: fs.statSync(destino).size, sha256: hash.digest('hex'), saneada: sanear };
}

/**
 * Restaura la copia recién hecha en una base temporal y comprueba que los datos
 * están y que una credencial se descifra con la Master Key. Borra la base
 * temporal al terminar, pase lo que pase.
 *
 * Restaura conectada como el ROL DE LA APLICACIÓN, no como postgres: es lo que
 * evita la trampa R2 y, de paso, prueba que ese rol basta para recuperar.
 */
/**
 * Borra las bases de verificación que quedaron de ejecuciones interrumpidas.
 * Cada una es una copia completa y descifrable de las credenciales, así que no
 * debe quedarse ahí. Solo las de más de una hora: una ejecución
 * en curso no debe borrarle la base a otra.
 */
async function limpiarVerificaciones(admin) {
  const { rows } = await admin.query(
    "SELECT datname FROM pg_database WHERE datname LIKE 'icm_verify_%'");
  const limite = Date.now() - 60 * 60 * 1000;
  let n = 0;
  for (const { datname } of rows) {
    if (!datname.startsWith('icm_verify_')) continue;
    const cuando = Number(datname.slice('icm_verify_'.length));
    if (!Number.isFinite(cuando) || cuando >= limite) continue;
    await admin.query(`DROP DATABASE IF EXISTS ${ident(datname)} WITH (FORCE)`);
    n += 1;
  }
  return n;
}

async function verificar(copia, margen) {
  const temporal = `icm_verify_${Date.now()}`;
  const admin = new Client({ ...ADMIN_VERIFICA, database: 'postgres' });
  await admin.connect();

  const huerfanas = await limpiarVerificaciones(admin);
  if (huerfanas) log(`  limpieza: ${huerfanas} base(s) de verificación de ejecuciones interrumpidas`);

  // Un Ctrl-C o un apagado del servicio a mitad de la restauración dejaba viva la
  // base temporal. El barrido de arriba la recoge en la copia siguiente, pero más
  // vale no esperar hasta entonces: aquí se borra en cuanto llega la señal.
  const alInterrumpir = (senal) => async () => {
    log('');
    log(`  ${senal}: borrando la base de verificación ${temporal}`);
    try {
      const c = new Client({ ...ADMIN_VERIFICA, database: 'postgres' });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS ${ident(temporal)} WITH (FORCE)`);
      await c.end();
    } catch (e) {
      console.error(`  no se pudo borrar ${temporal}: ${e.message}. Bórrala a mano.`);
    }
    process.exit(130);
  };
  const senales = ['SIGINT', 'SIGTERM'].map((senal) => [senal, alInterrumpir(senal)]);
  for (const [senal, mano] of senales) process.once(senal, mano);

  try {
    await admin.query(`CREATE DATABASE ${ident(temporal)} OWNER ${ident(CONEXION.user)}`);
  } catch (e) {
    await admin.end();
    throw new Error(`No se pudo crear la base de verificación (${e.message}).\n`
      + `  --verify necesita un rol con permiso para crear bases. El de la aplicación (${CONEXION.user}) no lo tiene,\n`
      + '  y es mejor que siga sin tenerlo. Ejecuta la verificación pasando un rol administrador solo para esa vez:\n'
      + '  BACKUP_ADMIN_USER=postgres BACKUP_ADMIN_PASSWORD=... npm run backup -- --verify');
  }

  try {
    const psql = spawn(ejecutable('psql'), ['-h', CONEXION.host, '-p', String(CONEXION.port),
      '-U', CONEXION.user, '-d', temporal, '-v', 'ON_ERROR_STOP=1'], {
      env: { ...process.env, PGPASSWORD: CONEXION.password }, stdio: ['pipe', 'ignore', 'pipe'],
    });
    let errores = '';
    psql.stderr.on('data', (d) => { errores += d.toString(); });
    const restaurado = new Promise((resolve, reject) => {
      psql.on('error', reject);
      psql.on('close', (code) => (code === 0 ? resolve() : reject(new Error(errores.trim().split('\n')[0] || `psql código ${code}`))));
    });
    await Promise.all([
      pipeline(fs.createReadStream(copia.destino), zlib.createGunzip(), psql.stdin),
      restaurado,
    ]);

    const tras = await radiografia(temporal);
    const fuera = RECUENTOS.filter((k) => tras[k] < margen[k].min || tras[k] > margen[k].max);
    if (fuera.length) {
      throw new Error(`la copia restaurada no cuadra en: ${fuera.map((k) => `${k} ${tras[k]}, fuera de ${margen[k].min}..${margen[k].max}`).join(', ')}`);
    }

    // Que los datos estén no basta: hay que poder descifrarlos.
    //
    // Se prueba con una credencial y, si no hay ninguna viva, con un secreto
    // TOTP, que está cifrado con la misma clave. Antes solo se miraban las
    // credenciales y, si no había, --verify respondía 'no hay nada que probar' y
    // daba la copia por verificada igual: en esta misma máquina, con las diez
    // credenciales borradas y el secreto purgado por la migración 008, el
    // descifrado no se llegó a probar nunca. Sin ningún secreto
    // cifrado que probar, queda al menos comprobar que la clave del .env es la
    // que la copia dice llevar, y se dice con todas las letras.
    const c = new Client({ ...CONEXION, database: temporal });
    c.on('error', () => {});   // la base se borra al salir; su cierre no es un fallo
    await c.connect();
    let descifrada;
    try {
      const pruebas = [
        ['una credencial se descifra', `SELECT pgp_sym_decrypt(password_encrypted::bytea, $1::text) AS p
             FROM sch_secret.tbl_credentials
            WHERE estado_registro = 'O' AND password_encrypted IS NOT NULL LIMIT 1`],
        ['un secreto del segundo factor se descifra', `SELECT pgp_sym_decrypt(mfa_secret_encrypted::bytea, $1::text) AS p
             FROM sch_system.tbl_users
            WHERE mfa_secret_encrypted IS NOT NULL LIMIT 1`],
      ];
      for (const [etiqueta, sql] of pruebas) {
        const { rows } = await c.query(sql, [process.env.MASTER_KEY]);
        if (rows.length) { descifrada = etiqueta; break; }
      }
      if (!descifrada) {
        const { rows } = await c.query('SELECT key_hash FROM sch_secret.tbl_master_config WHERE is_active = true');
        const casa = rows[0] && rows[0].key_hash === crypto.createHash('sha256').update(process.env.MASTER_KEY || '').digest('hex');
        if (!casa) {
          throw new Error('no hay ningún secreto cifrado que probar Y la MASTER_KEY de este .env no es la clave activa de la copia. '
            + 'El descifrado NO queda comprobado.');
        }
        descifrada = 'AVISO: no hay ningún secreto cifrado que probar; solo se ha comprobado que la MASTER_KEY del .env es la clave activa de la copia';
      }
    } catch (e) {
      throw new Error(/Wrong key|corrupt/i.test(e.message)
        ? 'la copia NO se descifra con la MASTER_KEY de este .env: comprueba que es la clave activa (master_key_activa en el .meta.json)'
        : `no se pudo comprobar el descifrado: ${e.message}`);
    } finally {
      await c.end().catch(() => {});
    }
    return { recuentos: 'coinciden', descifrada };
  } finally {
    for (const [senal, mano] of senales) process.removeListener(senal, mano);
    const cliente = new Client({ ...ADMIN_VERIFICA, database: 'postgres' });
    await cliente.connect();
    await cliente.query(`DROP DATABASE IF EXISTS ${ident(temporal)} WITH (FORCE)`);
    await cliente.end();
    await admin.end();
  }
}

// -----------------------------------------------------------------------------
// Principal
// -----------------------------------------------------------------------------

async function main() {
  const conservar = leerRetencion();

  if (LIST) {
    const copias = inventario();
    log(`Copias en ${DIR}: ${copias.length}`);
    for (const c of copias) log(`  ${c.fichero}  ${mb(c.bytes).padStart(9)}  ${c.fecha.toLocaleString()}`);
    if (copias.length) {
      const sobran = seleccionarParaBorrar(copias, conservar);
      log(`\nLa próxima ejecución borraría ${sobran.length}: ${sobran.map((c) => c.fichero).join(', ') || '(ninguna)'}`);
    }
    return;
  }

  log(`Copia de seguridad de ${CONEXION.database} en ${CONEXION.host}`);
  log(`  destino: ${DIR}`);
  const versiones = await comprobarVersiones();
  const antes = await radiografia();
  log(`  contenido: ${antes.usuarios} usuarios, ${antes.credenciales} credenciales, ${antes.auditoria} de auditoría`);

  if (DRY) {
    const sobran = seleccionarParaBorrar(inventario(), conservar);
    log(`\n(simulación) Se escribiría ${PREFIJO}${sello()}.sql.gz`);
    log(`(simulación) Se borrarían ${sobran.length} copias antiguas: ${sobran.map((c) => c.fichero).join(', ') || '(ninguna)'}`);
    return;
  }

  prepararDirectorio();
  const parciales = limpiarParciales();
  if (parciales) log(`  limpieza: ${parciales} volcado(s) a medias de ejecuciones anteriores`);
  const t0 = Date.now();
  const copia = await copiar({ sanear: versiones.sanear });
  log(`  copia: ${copia.fichero}  ${mb(copia.bytes)}  ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  // Segunda radiografía, DESPUÉS del volcado. La de antes sola no bastaba: da el
  // margen de los recuentos y, sobre todo, dice qué clave está activa al
  // cerrar la copia. Si una rotación de Master Key cae en mitad del volcado, el
  // .meta.json escrito con la lectura previa nombraría la clave vieja para unos
  // datos cifrados con la nueva: justo lo que el .meta.json existe para evitar.
  const despues = await radiografia();
  const rotoEnMedio = Boolean(antes.clave && despues.clave
    && antes.clave.key_hash !== despues.clave.key_hash);

  // Ficha al lado de cada copia: qué contiene, y QUÉ CLAVE la abre (solo el hash
  // de la Master Key, nunca la clave). Sin esto, con varias copias y una rotación
  // de por medio, no hay forma de saber cuál se descifra con cuál.
  const meta = {
    fichero: copia.fichero,
    fecha: new Date().toISOString(),
    origen: { host: CONEXION.host, base: CONEXION.database },
    sha256_sin_comprimir: copia.sha256,
    bytes: copia.bytes,
    versiones: { pg_dump: versiones.mayorCliente, servidor: versiones.mayorServidor },
    ...(copia.saneada ? { saneada: 'Se quitaron ajustes de cabecera que el servidor de origen no reconoce (versiones distintas).' } : {}),
    recuentos: { usuarios: despues.usuarios, credenciales: despues.credenciales, auditoria: despues.auditoria, ajustes: despues.ajustes },
    ...(RECUENTOS.some((k) => antes[k] !== despues[k])
      ? {
        recuentos_al_empezar: { usuarios: antes.usuarios, credenciales: antes.credenciales, auditoria: antes.auditoria, ajustes: antes.ajustes },
        nota_recuentos: 'La base tuvo actividad durante la copia: el volcado está entre las dos lecturas.',
      }
      : {}),
    master_key_activa: rotoEnMedio ? null : despues.clave,
    ...(rotoEnMedio
      ? {
        master_key_indeterminada: {
          al_empezar: antes.clave,
          al_terminar: despues.clave,
          aviso: 'La Master Key se rotó mientras se hacía esta copia: no se sabe cuál de las dos abre el volcado. Repite la copia y usa esa.',
        },
      }
      : {}),
    aviso: 'Esta copia NO contiene la MASTER_KEY. Sin ella las credenciales no se pueden descifrar.',
  };
  fs.writeFileSync(path.join(DIR, `${copia.fichero}.meta.json`), JSON.stringify(meta, null, 2), { mode: 0o600 });

  if (rotoEnMedio) {
    // No se borra: puede ser perfectamente buena. Pero no se puede etiquetar, y
    // la retención no debe correr con una copia de clave desconocida como la más
    // reciente, porque desplazaría a una que sí se sabe abrir.
    throw new Error(`la Master Key se rotó durante la copia (${antes.clave.key_alias} → ${despues.clave.key_alias}). `
      + `${copia.fichero} se conserva, pero no se sabe cuál de las dos claves la abre: repite la copia.`);
  }

  if (VERIFY) {
    const r = await verificar(copia, intervalo(antes, despues));
    log(`  verificada: restaurada en una base temporal, recuentos ${r.recuentos}, ${r.descifrada}`);
  }

  const sobran = seleccionarParaBorrar(inventario(), conservar);
  for (const c of sobran) {
    fs.rmSync(c.ruta, { force: true });
    fs.rmSync(`${c.ruta}.meta.json`, { force: true });
  }
  const quedan = inventario().length;
  log(`  retención: ${sobran.length} borradas, ${quedan} copias guardadas `
    + `(${conservar.diarias} diarias, ${conservar.semanales} semanales, ${conservar.mensuales} mensuales)`);
  log(`OK ${copia.fichero} ${mb(copia.bytes)}${VERIFY ? ' verificada' : ''}`);
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((e) => { console.error(`FALLO: ${e.message}`); process.exit(1); });
}

module.exports = { seleccionarParaBorrar, claveSemana, leerRetencion, intervalo, saneador, ident };
