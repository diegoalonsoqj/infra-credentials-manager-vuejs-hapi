'use strict';

const { query } = require('./database');
const logger = require('../utils/logger');

// =============================================================================
// settings.js — Lectura de tbl_system_settings desde el codigo.
//
// POR QUE EXISTE:
//   La tabla la escribia el panel de administracion y no la leia nadie. Cinco de
//   los siete ajustes de la categoria "security" eran controles inertes: el
//   panel los mostraba, el admin los guardaba, y el backend seguia usando su
//   valor de .env o una constante en el codigo. Un control de seguridad que
//   aparenta funcionar es peor que no ofrecerlo, porque quien lo configura cree
//   haber endurecido algo.
//
// CACHE:
//   Los ajustes se consultan en caminos calientes (cada login, cada validacion
//   de contrasena) y cambian muy de tarde en tarde. Se cachean TTL_MS y el PUT
//   del panel invalida la cache al guardar, de modo que un cambio se ve al
//   instante en el proceso que lo atendio y como mucho TTL_MS despues en el
//   resto (relevante solo si algun dia se corre en cluster).
//
// FALLBACKS:
//   Si la tabla no responde —arranque a medias, BD caida— se devuelve el valor
//   por defecto en vez de propagar el error. Un fallo leyendo la configuracion
//   no debe tumbar un login, pero tampoco debe abrir nada: los defaults son los
//   valores seguros que ya estaban en el codigo.
// =============================================================================

const TTL_MS = 30 * 1000;

let cache = null;
let cachedAt = 0;

/**
 * Marca la cache como vencida. La llama el PUT del panel tras guardar un ajuste.
 *
 * Vence la cache pero NO la borra: si la relectura posterior falla porque la BD
 * no responde, load() conserva el ultimo valor conocido en vez de caer a los
 * defaults. Borrarla aqui convertiria un corte de BD en una relajacion silenciosa
 * de cualquier limite que el admin hubiera endurecido.
 */
function invalidate() {
  cachedAt = 0;
}

/**
 * Devuelve todos los ajustes como { key: value } (valores en texto, tal cual
 * estan en la tabla). Refresca la cache si ha vencido.
 */
async function load() {
  const now = Date.now();
  if (cache && now - cachedAt < TTL_MS) return cache;

  try {
    const { rows } = await query('SELECT key, value FROM sch_system.tbl_system_settings');
    cache = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    cachedAt = now;
  } catch (err) {
    // Se conserva la cache anterior si la habia: es mejor un valor de hace un
    // minuto que caer al default y relajar un limite sin querer.
    logger.error('No se pudieron leer los ajustes del sistema.', { code: err.code });
    if (!cache) cache = {};
  }

  return cache;
}

/**
 * Entero con minimo y maximo. Un valor ausente, no numerico o fuera de rango
 * cae al default: la tabla la edita un humano y un 0 mal puesto en
 * "duracion de sesion" no debe traducirse en sesiones de duracion cero.
 *
 * @param {string} key
 * @param {number} fallback - Valor si el ajuste falta o no es utilizable.
 * @param {{min?: number, max?: number}} [range]
 */
async function getInt(key, fallback, range = {}) {
  const all = await load();
  const raw = all[key];
  if (raw === undefined || raw === null || raw === '') return fallback;

  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  if (range.min !== undefined && n < range.min) return fallback;
  if (range.max !== undefined && n > range.max) return fallback;
  return n;
}

/**
 * Booleano. Solo 'true' y 'false' son valores validos (es lo que valida el PUT);
 * cualquier otra cosa cae al default.
 */
async function getBool(key, fallback) {
  const all = await load();
  const raw = all[key];
  if (raw === 'true')  return true;
  if (raw === 'false') return false;
  return fallback;
}

/**
 * Texto de una lista cerrada. Un valor fuera de `allowed` cae al default, igual
 * que un entero fuera de rango: nunca se aplica algo que el código no conoce.
 */
async function getString(key, fallback, allowed) {
  const all = await load();
  const raw = all[key];
  if (typeof raw !== 'string' || raw === '') return fallback;
  if (allowed && !allowed.includes(raw)) return fallback;
  return raw;
}

module.exports = { getInt, getBool, getString, invalidate, TTL_MS };
