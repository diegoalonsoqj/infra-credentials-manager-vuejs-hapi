'use strict';

const { query, withTransaction }   = require('../config/database');
const { encryptQuery, decryptQuery, verifyMasterKey } = require('../utils/crypto');
const { likePattern } = require('../utils/sqlLike');

// ---------------------------------------------------------------------------
// Master Key coherente con la escritura
// ---------------------------------------------------------------------------

/**
 * La Master Key del proceso no coincide con la activa en BD. Casi siempre es
 * una rotacion en curso o recien confirmada; el cliente puede reintentar.
 */
class MasterKeyUnavailableError extends Error {
  constructor() {
    super('La Master Key se está rotando en este momento. Intenta de nuevo en unos segundos; ' +
          'si el error persiste, contacta al administrador.');
    this.name = 'MasterKeyUnavailableError';
    this.isKeyUnavailable = true;
  }
}

/**
 * Ejecuta fn(client, masterKey) en una transaccion que retiene, en modo
 * compartido, la fila de la Master Key activa.
 *
 * POR QUE EXISTE:
 *   La rotacion (security.routes.js) re-cifra todas las filas en un UPDATE y
 *   solo DESPUES del COMMIT cambia process.env.MASTER_KEY. Una escritura
 *   concurrente leia la clave del proceso sin coordinarse con ella:
 *     - un INSERT confirmado mientras corria el UPDATE no entraba en el
 *       re-cifrado, y quedaba cifrado con la clave vieja;
 *     - un cambio de contraseña bloqueado por la fila en rotacion la
 *       sobrescribia, al liberarse, con un cifrado con la clave vieja.
 *   En los dos casos la clave vieja desaparece del .env al terminar, y esa
 *   credencial no se puede volver a descifrar nunca.
 *
 * COMO LO EVITA:
 *   La rotacion bloquea esta misma fila con FOR UPDATE antes de re-cifrar.
 *     - Si la escritura llega antes, la rotacion espera a su COMMIT, y la fila
 *       nueva ya es visible para el UPDATE de re-cifrado.
 *     - Si la rotacion llega antes, la escritura espera; al confirmarse la
 *       rotacion esa fila ya no esta activa y la consulta no devuelve nada.
 *     - Entre el COMMIT de la rotacion y la asignacion de process.env, la fila
 *       activa es la nueva y su hash no casa con la clave del proceso.
 *   En los tres casos, o se cifra con la clave correcta o no se escribe nada.
 *
 * CUANTO SE ESPERA:
 *   Como mucho KEY_LOCK_TIMEOUT. Sin límite propio, la espera la cortaba el
 *   statement_timeout del pool (30 s) con un error genérico, y el cliente
 *   recibía un 500 en vez del 503 "reintenta". Una rotación con muchas
 *   credenciales dura más que eso: 20.000 filas tardaron 41 s en una medición
 *   real.
 *
 * @param {function(object, string): Promise<*>} fn
 * @returns {Promise<*>}
 * @throws {MasterKeyUnavailableError}
 */
const KEY_LOCK_TIMEOUT = '10s';

async function withActiveMasterKey(fn) {
  return withTransaction(async (client) => {
    await client.query(`SET LOCAL lock_timeout = '${KEY_LOCK_TIMEOUT}'`);
    let rows;
    try {
      ({ rows } = await client.query(
        `SELECT key_hash FROM sch_secret.tbl_master_config
         WHERE is_active = TRUE
         FOR SHARE`
      ));
    } catch (err) {
      // 55P03 lock_not_available: sigue la rotación. No se ha escrito nada.
      if (err.code === '55P03') throw new MasterKeyUnavailableError();
      throw err;
    }
    // Se lee DESPUES de obtener el bloqueo: es la clave vigente en ese instante.
    const masterKey = process.env.MASTER_KEY;
    if (!masterKey || !rows.some((r) => verifyMasterKey(masterKey, r.key_hash))) {
      throw new MasterKeyUnavailableError();
    }
    return fn(client, masterKey);
  });
}

// =============================================================================
// credentials.repository.js — Queries de BD para gestión de credenciales.
//
// REGLAS ABSOLUTAS DE SEGURIDAD:
//   1. password_encrypted NUNCA aparece en queries de lista ni de detalle.
//   2. El descifrado ocurre ÚNICAMENTE en decryptPassword(), y solo cuando
//      el servicio lo solicita explícitamente tras validar RBAC y custodia.
//   3. La MASTER_KEY solo se pasa como parámetro ($N), nunca interpolada.
//   4. encryptQuery y decryptQuery generan los fragmentos pgcrypto en SQL.
//
// FKs en tbl_credentials (post-013):
//   server_id     → tbl_servers      (resource_type = 'OS')
//   db_service_id → tbl_db_services  (resource_type = 'DB')
//   application_id → tbl_applications (resource_type = 'APP')
//   XOR: exactamente uno debe ser NOT NULL.
// =============================================================================

// ---------------------------------------------------------------------------
// Catálogos (para formularios de creación)
// ---------------------------------------------------------------------------

async function findAvailableDbServices() {
  const { rows } = await query(
    `SELECT
       d.id, d.code, d.name, d.host, d.port, d.estado,
       e.id   AS environment_id, e.code AS environment_code,
       e.name AS environment_name, e.prd_flag, e.sort_order,
       eng.code AS engine_code, eng.name AS engine_name
     FROM sch_system.tbl_db_services d
     JOIN sch_system.tbl_environment    e   ON e.id   = d.environment_id
     LEFT JOIN sch_system.tbl_cat_db_engine eng ON eng.id = d.engine_id
     WHERE d.estado_registro = 'O' AND d.estado = 'AI'
     ORDER BY e.sort_order, d.name`
  );
  return rows;
}

async function findAvailableServers() {
  const { rows } = await query(
    `SELECT
       s.id, s.code, s.name, s.hostname, s.ip_address::text, s.estado,
       e.id   AS environment_id, e.code AS environment_code,
       e.name AS environment_name, e.prd_flag, e.sort_order,
       os.code AS os_code, os.name AS os_name
     FROM sch_system.tbl_servers s
     JOIN sch_system.tbl_environment e  ON e.id  = s.environment_id
     LEFT JOIN sch_system.tbl_cat_os os ON os.id = s.os_id
     WHERE s.estado_registro = 'O' AND s.estado = 'AI'
     ORDER BY e.sort_order, s.name`
  );
  return rows;
}

async function findAvailableApplications() {
  const { rows } = await query(
    `SELECT
       a.id, a.code, a.name, a.app_type, a.url, a.estado,
       e.id   AS environment_id, e.code AS environment_code,
       e.name AS environment_name, e.prd_flag, e.sort_order
     FROM sch_system.tbl_applications a
     JOIN sch_system.tbl_environment  e ON e.id = a.environment_id
     WHERE a.estado_registro = 'O' AND a.estado = 'AI'
     ORDER BY e.sort_order, a.name`
  );
  return rows;
}

// Instancia activa para el alta de credenciales: el código y la marca de PRD
// van a la auditoría del alta, igual que en el resto de eventos.
async function findDbServiceById(id) {
  const { rows } = await query(
    `SELECT d.id, d.code, e.prd_flag
       FROM sch_system.tbl_db_services d
       JOIN sch_system.tbl_environment e ON e.id = d.environment_id
      WHERE d.id = $1 AND d.estado_registro = 'O' AND d.estado = 'AI'`,
    [id]
  );
  return rows[0] || null;
}

async function findServerById(id) {
  const { rows } = await query(
    `SELECT s.id, s.code, e.prd_flag
       FROM sch_system.tbl_servers s
       JOIN sch_system.tbl_environment e ON e.id = s.environment_id
      WHERE s.id = $1 AND s.estado_registro = 'O' AND s.estado = 'AI'`,
    [id]
  );
  return rows[0] || null;
}

async function findApplicationById(id) {
  const { rows } = await query(
    `SELECT a.id, a.code, e.prd_flag
       FROM sch_system.tbl_applications a
       JOIN sch_system.tbl_environment e ON e.id = a.environment_id
      WHERE a.id = $1 AND a.estado_registro = 'O' AND a.estado = 'AI'`,
    [id]
  );
  return rows[0] || null;
}

async function findActiveUsers() {
  const { rows } = await query(
    `SELECT u.id, u.username, u.full_name, r.code AS role, t.code AS team
     FROM sch_system.tbl_users u
     JOIN sch_system.tbl_roles r ON r.id = u.role_id
     LEFT JOIN sch_system.tbl_teams t ON t.id = u.team_id
     WHERE u.estado_registro = 'O' AND u.estado = 'AI'
     ORDER BY u.username`
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Credenciales — Lectura (NUNCA incluir password_encrypted)
// ---------------------------------------------------------------------------

async function findAll({ page = 1, limit = 20, search = '', resourceTypes = null, environmentId, filterResourceType, custodied, estado } = {}) {
  const offset      = (page - 1) * limit;
  const searchParam = likePattern(search);

  const { rows } = await query(
    `SELECT
       c.id, c.resource_type,
       c.server_id, c.db_service_id, c.application_id,
       c.username, c.description, c.notes,
       c.is_custodied, c.custodian_user_id,
       cu.username  AS custodian_username,
       cu.full_name AS custodian_full_name,
       c.estado, c.estado_registro, c.created_at, c.updated_at,
       -- Servidor (OS)
       s.code AS server_code, s.name AS server_name,
       s.hostname AS server_hostname, s.ip_address::text AS server_ip,
       -- Servicio de BD
       d.code AS db_code, d.name AS db_name, d.host AS db_host, d.port AS db_port,
       eng.code AS engine_code, eng.name AS engine_name,
       -- Aplicación
       a.code AS app_code, a.name AS app_name, a.app_type, a.url AS app_url,
       -- Ambiente (desnormalizado del recurso referenciado)
       COALESCE(es.code,  ed.code,  ea.code)     AS environment_code,
       COALESCE(es.name,  ed.name,  ea.name)     AS environment_name,
       COALESCE(es.prd_flag, ed.prd_flag, ea.prd_flag) AS prd_flag
     FROM sch_secret.tbl_credentials c
     LEFT JOIN sch_system.tbl_servers        s   ON s.id   = c.server_id
     LEFT JOIN sch_system.tbl_environment    es  ON es.id  = s.environment_id
     LEFT JOIN sch_system.tbl_db_services    d   ON d.id   = c.db_service_id
     LEFT JOIN sch_system.tbl_environment    ed  ON ed.id  = d.environment_id
     LEFT JOIN sch_system.tbl_cat_db_engine  eng ON eng.id = d.engine_id
     LEFT JOIN sch_system.tbl_applications   a   ON a.id   = c.application_id
     LEFT JOIN sch_system.tbl_environment    ea  ON ea.id  = a.environment_id
     LEFT JOIN sch_system.tbl_users          cu  ON cu.id  = c.custodian_user_id
     WHERE c.estado_registro = 'O'
       AND ($3::text[] IS NULL OR c.resource_type = ANY($3::text[]))
       AND ($4::text IS NULL OR (
         LOWER(c.username) LIKE $4 OR
         LOWER(s.code)     LIKE $4 OR LOWER(s.name) LIKE $4 OR
         LOWER(d.code)     LIKE $4 OR LOWER(d.name) LIKE $4 OR
         LOWER(a.code)     LIKE $4 OR LOWER(a.name) LIKE $4
       ))
       AND ($5::int IS NULL OR COALESCE(s.environment_id, d.environment_id, a.environment_id) = $5)
       AND ($6::text IS NULL OR c.resource_type = $6)
       AND ($7::boolean IS NULL OR c.is_custodied = $7)
       AND ($8::text IS NULL OR c.estado = $8)
     ORDER BY
       COALESCE(es.sort_order, ed.sort_order, ea.sort_order) NULLS LAST,
       COALESCE(s.name, d.name, a.name) NULLS LAST
     LIMIT $1 OFFSET $2`,
    [limit, offset, resourceTypes, searchParam, environmentId || null, filterResourceType || null, custodied != null ? custodied : null, estado || null]
  );

  const { rows: countRows } = await query(
    `SELECT COUNT(*) AS total
     FROM sch_secret.tbl_credentials c
     LEFT JOIN sch_system.tbl_servers      s ON s.id = c.server_id
     LEFT JOIN sch_system.tbl_db_services  d ON d.id = c.db_service_id
     LEFT JOIN sch_system.tbl_applications a ON a.id = c.application_id
     WHERE c.estado_registro = 'O'
       AND ($1::text[] IS NULL OR c.resource_type = ANY($1::text[]))
       AND ($2::text IS NULL OR (
         LOWER(c.username) LIKE $2 OR
         LOWER(s.code) LIKE $2 OR LOWER(s.name) LIKE $2 OR
         LOWER(d.code) LIKE $2 OR LOWER(d.name) LIKE $2 OR
         LOWER(a.code) LIKE $2 OR LOWER(a.name) LIKE $2
       ))
       AND ($3::int IS NULL OR COALESCE(s.environment_id, d.environment_id, a.environment_id) = $3)
       AND ($4::text IS NULL OR c.resource_type = $4)
       AND ($5::boolean IS NULL OR c.is_custodied = $5)
       AND ($6::text IS NULL OR c.estado = $6)`,
    [resourceTypes, searchParam, environmentId || null, filterResourceType || null, custodied != null ? custodied : null, estado || null]
  );

  return { credentials: rows, total: parseInt(countRows[0].total, 10), page, limit };
}

async function findById(id) {
  const { rows } = await query(
    `SELECT
       c.id, c.resource_type,
       c.server_id, c.db_service_id, c.application_id,
       c.username, c.description, c.notes,
       c.is_custodied, c.custodian_user_id,
       cu.username  AS custodian_username,
       cu.full_name AS custodian_full_name,
       c.estado, c.estado_registro, c.created_at, c.updated_at,
       s.code AS server_code, s.name AS server_name,
       s.hostname AS server_hostname, s.ip_address::text AS server_ip,
       d.code AS db_code, d.name AS db_name, d.host AS db_host, d.port AS db_port,
       eng.code AS engine_code, eng.name AS engine_name,
       a.code AS app_code, a.name AS app_name, a.app_type, a.url AS app_url,
       COALESCE(es.code,  ed.code,  ea.code)     AS environment_code,
       COALESCE(es.name,  ed.name,  ea.name)     AS environment_name,
       COALESCE(es.prd_flag, ed.prd_flag, ea.prd_flag) AS prd_flag
     FROM sch_secret.tbl_credentials c
     LEFT JOIN sch_system.tbl_servers        s   ON s.id   = c.server_id
     LEFT JOIN sch_system.tbl_environment    es  ON es.id  = s.environment_id
     LEFT JOIN sch_system.tbl_db_services    d   ON d.id   = c.db_service_id
     LEFT JOIN sch_system.tbl_environment    ed  ON ed.id  = d.environment_id
     LEFT JOIN sch_system.tbl_cat_db_engine  eng ON eng.id = d.engine_id
     LEFT JOIN sch_system.tbl_applications   a   ON a.id   = c.application_id
     LEFT JOIN sch_system.tbl_environment    ea  ON ea.id  = a.environment_id
     LEFT JOIN sch_system.tbl_users          cu  ON cu.id  = c.custodian_user_id
     WHERE c.id = $1 AND c.estado_registro = 'O'`,
    [id]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// Descifrado — ÚNICA función que accede a password_encrypted
// ---------------------------------------------------------------------------

async function decryptPassword(id, masterKey) {
  const { rows } = await query(
    `SELECT ${decryptQuery('password_encrypted', 2)} AS plain_password
     FROM sch_secret.tbl_credentials
     WHERE id = $1 AND estado_registro = 'O' AND estado = 'AI'`,
    [id, masterKey]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

async function create({
  serverId, dbServiceId, applicationId, resourceType, username,
  plainPassword, description, notes,
  isCustodied, custodianUserId, createdBy,
}) {
  return withActiveMasterKey(async (client, masterKey) => {
    const { rows } = await client.query(
      `INSERT INTO sch_secret.tbl_credentials
         (server_id, db_service_id, application_id, resource_type,
          username, password_encrypted,
          description, notes,
          is_custodied, custodian_user_id, custodian_since,
          estado_registro, estado, created_by)
       VALUES ($1, $2, $3, $4, $5, ${encryptQuery(6, 7)},
               $8, $9,
               $10, $11, $12,
               'O', 'AI', $13)
       RETURNING id, username, resource_type`,
      [
        serverId        || null,
        dbServiceId     || null,
        applicationId   || null,
        resourceType,
        username.trim(),
        plainPassword, masterKey,
        description     || null,
        notes           || null,
        isCustodied     || false,
        custodianUserId || null,
        isCustodied ? new Date() : null,
        createdBy,
      ]
    );
    return rows[0];
  });
}

const UPDATE_METADATA_SQL = `
  UPDATE sch_secret.tbl_credentials
  SET username    = $2,
      description = $3,
      notes       = $4,
      updated_at  = NOW()
  WHERE id = $1 AND estado_registro = 'O'
  RETURNING id, username`;

/**
 * Actualiza los metadatos y, si se indica newPassword, la contraseña.
 *
 * Con contraseña nueva, las dos sentencias van en la misma transacción y bajo
 * withActiveMasterKey. Antes eran dos llamadas sueltas: si fallaba la segunda,
 * los metadatos quedaban cambiados sin la contraseña y sin auditoría.
 */
async function update(id, { username, description, notes, newPassword }) {
  const params = [id, username.trim(), description || null, notes || null];

  if (!newPassword) {
    const { rows } = await query(UPDATE_METADATA_SQL, params);
    return rows[0] || null;
  }

  return withActiveMasterKey(async (client, masterKey) => {
    const { rows } = await client.query(UPDATE_METADATA_SQL, params);
    if (!rows[0]) return null;

    await client.query(
      `UPDATE sch_secret.tbl_credentials
       SET password_encrypted = ${encryptQuery(2, 3)}, updated_at = NOW()
       WHERE id = $1 AND estado_registro = 'O'`,
      [id, newPassword, masterKey]
    );
    return rows[0];
  });
}

async function setEstado(id, estado) {
  const { rows } = await query(
    `UPDATE sch_secret.tbl_credentials
     SET estado = $2, updated_at = NOW()
     WHERE id = $1 AND estado_registro = 'O'
     RETURNING id, username, estado`,
    [id, estado]
  );
  return rows[0] || null;
}

async function updateCustodian(id, newCustodianUserId) {
  const { rows } = await query(
    `UPDATE sch_secret.tbl_credentials
     SET custodian_user_id = $2,
         custodian_since   = NOW(),
         updated_at        = NOW()
     WHERE id = $1 AND estado_registro = 'O' AND is_custodied = TRUE
     RETURNING id, username, custodian_user_id`,
    [id, newCustodianUserId]
  );
  return rows[0] || null;
}

/**
 * Borrado logico. Purga ademas la contrasena cifrada (ver migracion 008): la
 * fila se conserva por auditoria, pero el secreto de una credencial eliminada
 * no tiene por que seguir ahi. La aplicacion nunca podria descifrarlo
 * —decryptPassword exige estado_registro = 'O' AND estado = 'AI'— y dejarlo
 * ademas lo condenaba a quedar ilegible en la siguiente rotacion de Master Key,
 * que solo re-cifra las filas activas.
 */
async function softDelete(id) {
  const { rows } = await query(
    `UPDATE sch_secret.tbl_credentials
     SET estado_registro    = 'X',
         estado             = 'IN',
         password_encrypted = NULL,
         updated_at         = NOW()
     WHERE id = $1 AND estado_registro = 'O'
     RETURNING id, username`,
    [id]
  );
  return rows[0] || null;
}

module.exports = {
  findAvailableDbServices,
  findAvailableServers,
  findAvailableApplications,
  findDbServiceById,
  findServerById,
  findApplicationById,
  findActiveUsers,
  findAll,
  findById,
  decryptPassword,
  create,
  update,
  setEstado,
  updateCustodian,
  softDelete,
  withActiveMasterKey,
  MasterKeyUnavailableError,
};
