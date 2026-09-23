'use strict';

const { Pool } = require('pg');
const fs = require('fs');
const logger = require('../utils/logger');

// ---------------------------------------------------------------------------
// buildSslOption — Construye la opción `ssl` del Pool de forma SEGURA POR DEFECTO.
//
//   - SSL deshabilitado  → false (sin TLS).
//   - SSL habilitado     → valida el certificado del servidor (rejectUnauthorized: true).
//
// Escapes explícitos (solo si el operador los configura a propósito):
//   - DB_SSL_CA=/ruta/ca.crt           → valida contra una CA propia (RECOMENDADO para PKI interna).
//   - DB_SSL_REJECT_UNAUTHORIZED=false → desactiva la validación del cert (INSEGURO: expone a MITM;
//                                        usar solo en entornos de prueba con cert autofirmado).
//
// Nota: con DB_SSL=false (caso por defecto) esta función devuelve false y el
// comportamiento es idéntico al anterior — no cambia nada hasta que se active SSL.
// ---------------------------------------------------------------------------
function buildSslOption(sslEnabled) {
  if (!sslEnabled) return false;

  const rejectUnauthorized = process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false';
  const sslOption = { rejectUnauthorized };

  if (process.env.DB_SSL_CA) {
    try {
      sslOption.ca = fs.readFileSync(process.env.DB_SSL_CA, 'utf8');
    } catch (err) {
      logger.error('No se pudo leer DB_SSL_CA; se usará la validación por defecto.', { code: err.code });
    }
  }

  return sslOption;
}

// =============================================================================
// database.js — Gestión de conexiones PostgreSQL.
//
// PRINCIPIOS DE SEGURIDAD:
// 1. Pool singleton: una sola instancia por proceso.
// 2. Error handler del pool: NUNCA expone detalles de PG en logs de producción.
// 3. testConnection: pool temporal max:1, siempre se cierra en finally.
// 4. query: parámetros siempre como array, NUNCA interpolación de strings.
// 5. withTransaction: atomicidad garantizada con ROLLBACK en cualquier error.
// =============================================================================

/** @type {Pool|null} Pool singleton de conexiones principal */
let _pool = null;

/**
 * Construye la configuración del pool desde variables de entorno.
 * @param {object} [override] - Configuración override (para wizard/testConnection).
 * @returns {object} Configuración para new Pool().
 */
function buildPoolConfig(override = null) {
  if (override) {
    return {
      host:               override.host,
      port:               parseInt(override.port, 10) || 5432,
      database:           override.name,
      user:               override.user,
      password:           override.password,
      ssl:                buildSslOption(override.ssl),
      max:                1,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis:  5000,
    };
  }

  const sslConfig = buildSslOption(process.env.DB_SSL === 'true');

  // Timeouts del lado del SERVIDOR. El Promise.race de query() rechaza en Node y
  // destruye la conexion, pero PostgreSQL solo aborta la consulta cuando detecta
  // la desconexion: ni es inmediato ni esta garantizado. statement_timeout si la
  // cancela de verdad, y ademas cubre withTransaction, que no tenia ningun
  // timeout: una transaccion colgada retenia un cliente del pool para siempre y
  // diez de ellas dejaban la aplicacion sin conexiones.
  // idle_in_transaction_session_timeout cierra las transacciones abiertas que se
  // quedan sin actividad, que retienen tanto la conexion como sus bloqueos.
  const statementTimeout = parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '30000', 10);
  const idleTxTimeout    = parseInt(process.env.DB_IDLE_TX_TIMEOUT_MS   || '60000', 10);

  return {
    host:                   process.env.DB_HOST     || 'localhost',
    port:                   parseInt(process.env.DB_PORT || '5432', 10),
    database:               process.env.DB_NAME     || 'icm_db',
    user:                   process.env.DB_USER     || 'icm_user',
    password:               process.env.DB_PASSWORD,
    ssl:                    sslConfig,
    min:                    parseInt(process.env.DB_POOL_MIN || '2', 10),
    max:                    parseInt(process.env.DB_POOL_MAX || '10', 10),
    idleTimeoutMillis:      parseInt(process.env.DB_POOL_IDLE_MS || '30000', 10),
    connectionTimeoutMillis: 10000,
    // La rotacion de Master Key sube su propio limite con SET LOCAL, porque
    // re-cifra todas las credenciales en una sola sentencia.
    options: `-c statement_timeout=${statementTimeout} `
           + `-c idle_in_transaction_session_timeout=${idleTxTimeout}`,
    application_name:       'icm-backend',
  };
}

/**
 * Retorna (o crea) el pool singleton de conexiones principal.
 * Si se pasa overrideConfig, crea un pool temporal (no singleton).
 *
 * @param {object} [overrideConfig] - Si se pasa, crea pool temporal.
 * @returns {Pool} Instancia del pool.
 */
function getPool(overrideConfig = null) {
  if (overrideConfig) {
    return new Pool(buildPoolConfig(overrideConfig));
  }

  if (!_pool) {
    _pool = new Pool(buildPoolConfig());

    // Error handler del pool: captura errores de clientes ociosos.
    // NUNCA exponer detalles internos de PostgreSQL en logs de producción.
    _pool.on('error', (err) => {
      if (process.env.NODE_ENV === 'production') {
        logger.error('Pool error: conexión ociosa terminada inesperadamente.');
      } else {
        logger.error('Pool error (dev):', { code: err.code, message: err.message });
      }
    });

    logger.info('Pool de conexiones PostgreSQL inicializado.', {
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
      min: process.env.DB_POOL_MIN || 2,
      max: process.env.DB_POOL_MAX || 10,
    });
  }

  return _pool;
}

/**
 * Prueba una conexión con configuración override (wizard de instalación).
 * Crea un pool temporal max:1 con timeout corto.
 * Siempre cierra el pool en finally.
 *
 * @param {object} config - { host, port, name, user, password, ssl }
 * @returns {Promise<{ success: boolean, code?: string, message?: string }>}
 */
async function testConnection(config) {
  const tempPool = new Pool({
    host:                   config.host,
    port:                   parseInt(config.port, 10) || 5432,
    database:               config.name,
    user:                   config.user,
    password:               config.password,
    ssl:                    buildSslOption(config.ssl),
    max:                    1,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis:      3000,
  });

  let client;
  try {
    client = await tempPool.connect();
    await client.query('SELECT 1');
    return { success: true };
  } catch (err) {
    // Loguear solo el código de error, nunca el mensaje completo en producción
    // El timeout de connectionTimeoutMillis de pg no trae código: se detecta por
    // el mensaje para no mostrarlo como un error genérico.
    const timedOut = !err.code && /timeout/i.test(err.message || '');
    logger.warn('testConnection failed', { code: err.code, timedOut });
    return { success: false, code: err.code, originalCode: err.code, timedOut };
  } finally {
    if (client) client.release();
    // Cerrar el pool temporal siempre, incluso si hubo error
    await tempPool.end().catch(() => {});
  }
}

/**
 * Ejecuta una query parametrizada usando el pool principal.
 * Obtiene cliente → ejecuta → libera.
 *
 * REGLA: params siempre debe ser un array para datos de usuario.
 * NUNCA interpolar datos de usuario directamente en el string sql.
 *
 * Si la query supera timeoutMs, el cliente se destruye (no vuelve al pool)
 * para evitar que una query colgada bloquee conexiones indefinidamente.
 *
 * @param {string} sql      - Query SQL con parámetros $1, $2, etc.
 * @param {Array}  params   - Valores para los parámetros.
 * @param {number} timeoutMs - Timeout en ms (default: 30 segundos).
 * @returns {Promise<import('pg').QueryResult>}
 */
async function query(sql, params = [], timeoutMs = 30000) {
  const pool = getPool();
  const client = await pool.connect();
  let timedOut = false;

  const queryPromise = client.query(sql, params);
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => {
      timedOut = true;
      reject(new Error(`Query timeout después de ${timeoutMs}ms`));
    }, timeoutMs)
  );

  try {
    return await Promise.race([queryPromise, timeoutPromise]);
  } finally {
    // Si hubo timeout, destruir el cliente en lugar de devolverlo al pool
    // para evitar que la query colgada interfiera con conexiones futuras.
    client.release(timedOut);
  }
}

/**
 * Ejecuta una función dentro de una transacción atómica.
 * BEGIN → fn(client) → COMMIT.
 * Si fn lanza cualquier error: ROLLBACK y re-throw.
 * Garantía: ninguna operación parcial queda confirmada en BD.
 *
 * @param {function(import('pg').PoolClient): Promise<*>} fn
 *   Función que recibe el cliente de transacción y ejecuta las queries.
 * @returns {Promise<*>} El valor retornado por fn.
 */
async function withTransaction(fn, overrideConfig = null) {
  const pool = overrideConfig ? new Pool(buildPoolConfig(overrideConfig)) : getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    if (overrideConfig) await pool.end().catch(() => {});
  }
}

/**
 * Cierra el pool principal. Útil en shutdown graceful.
 */
async function closePool() {
  if (_pool) {
    await _pool.end();
    _pool = null;
    logger.info('Pool de conexiones PostgreSQL cerrado.');
  }
}

/**
 * Resetea el pool singleton. Útil tras el wizard de instalación cuando
 * las variables de entorno se actualizan en caliente (sin reiniciar).
 */
async function resetPool() {
  if (_pool) {
    await _pool.end().catch(() => {});
    _pool = null;
    logger.info('Pool de conexiones PostgreSQL reseteado.');
  }
}

module.exports = {
  getPool,
  testConnection,
  query,
  withTransaction,
  closePool,
  resetPool,
};
