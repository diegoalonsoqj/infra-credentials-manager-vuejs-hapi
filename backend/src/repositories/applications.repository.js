'use strict';

const { query } = require('../config/database');
const { likePattern } = require('../utils/sqlLike');

// =============================================================================
// applications.repository.js — Queries para tbl_applications.
// Modelo plano: app + ambiente + server_id opcional (NULL si SaaS/cloud).
// =============================================================================

async function findAll({ page = 1, limit = 20, search = '', environmentId = null, appType = null } = {}) {
  const offset      = (page - 1) * limit;
  const searchParam = likePattern(search);

  const { rows } = await query(
    `SELECT
       a.id, a.code, a.name, a.app_type, a.url, a.description, a.owner_team_id,
       a.estado, a.estado_registro, a.created_at, a.updated_at,
       e.id   AS environment_id,   e.code AS environment_code,   e.name AS environment_name, e.prd_flag,
       s.id   AS server_id, s.code AS server_code, s.name AS server_name, s.hostname AS server_hostname
     FROM sch_system.tbl_applications a
     JOIN sch_system.tbl_environment  e  ON e.id = a.environment_id
     LEFT JOIN sch_system.tbl_servers s  ON s.id = a.server_id
     WHERE a.estado_registro = 'O'
       AND ($3::text IS NULL OR (LOWER(a.code) LIKE $3 OR LOWER(a.name) LIKE $3))
       AND ($4::int  IS NULL OR a.environment_id = $4)
       AND ($5::text IS NULL OR a.app_type       = $5)
     ORDER BY a.name ASC
     LIMIT $1 OFFSET $2`,
    [limit, offset, searchParam, environmentId || null, appType || null]
  );

  const { rows: countRows } = await query(
    `SELECT COUNT(*) AS total
     FROM sch_system.tbl_applications a
     WHERE a.estado_registro = 'O'
       AND ($1::text IS NULL OR (LOWER(a.code) LIKE $1 OR LOWER(a.name) LIKE $1))
       AND ($2::int  IS NULL OR a.environment_id = $2)
       AND ($3::text IS NULL OR a.app_type       = $3)`,
    [searchParam, environmentId || null, appType || null]
  );

  return { applications: rows, total: parseInt(countRows[0].total, 10), page, limit };
}

async function findById(id) {
  const { rows } = await query(
    `SELECT
       a.id, a.code, a.name, a.app_type, a.url, a.description, a.owner_team_id,
       a.estado, a.estado_registro, a.created_at, a.updated_at,
       a.environment_id, a.server_id,
       e.code AS environment_code, e.name AS environment_name, e.prd_flag,
       s.code AS server_code, s.name AS server_name, s.hostname AS server_hostname
     FROM sch_system.tbl_applications a
     JOIN sch_system.tbl_environment  e  ON e.id = a.environment_id
     LEFT JOIN sch_system.tbl_servers s  ON s.id = a.server_id
     WHERE a.id = $1 AND a.estado_registro = 'O'`,
    [id]
  );
  return rows[0] || null;
}

async function existsByCode(code, excludeId = null) {
  const { rows } = await query(
    `SELECT id FROM sch_system.tbl_applications
     WHERE LOWER(code) = LOWER($1) AND estado_registro = 'O'
       AND ($2::int IS NULL OR id != $2)`,
    [code, excludeId]
  );
  return rows.length > 0;
}

async function countCredentials(appId) {
  const { rows } = await query(
    `SELECT COUNT(*) AS total FROM sch_secret.tbl_credentials
     WHERE application_id = $1 AND estado_registro = 'O'`,
    [appId]
  );
  return parseInt(rows[0].total, 10);
}

async function create({ name, appType, url, environmentId, serverId, description, createdBy, ownerTeamId }) {
  const { rows: [ins] } = await query(
    `INSERT INTO sch_system.tbl_applications
       (code, name, app_type, url, environment_id, server_id, description, created_by, owner_team_id)
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, environment_id`,
    [
      name.trim(),
      appType     || 'WEB',
      url         || null,
      environmentId,
      serverId    || null,
      description || null,
      createdBy,
      ownerTeamId || null,
    ]
  );
  const { rows } = await query(
    `UPDATE sch_system.tbl_applications
     SET code = 'APP-' || e.code || '-' || LPAD($1::text, 4, '0')
     FROM sch_system.tbl_environment e
     WHERE e.id = $2 AND tbl_applications.id = $1
     RETURNING tbl_applications.id, tbl_applications.code,
               tbl_applications.name, tbl_applications.app_type, tbl_applications.url`,
    [ins.id, ins.environment_id]
  );
  return rows[0];
}

async function update(id, { name, appType, url, environmentId, serverId, description }) {
  const { rows } = await query(
    `UPDATE sch_system.tbl_applications
     SET name           = $2,
         app_type       = $3,
         url            = $4,
         environment_id = $5,
         server_id      = $6,
         description    = $7,
         updated_at     = NOW()
     WHERE id = $1 AND estado_registro = 'O'
     RETURNING id, code, name, app_type, url`,
    [
      id,
      name.trim(),
      appType     || 'WEB',
      url         || null,
      environmentId,
      serverId    || null,
      description || null,
    ]
  );
  return rows[0] || null;
}

async function toggleEstado(id) {
  const { rows } = await query(
    `UPDATE sch_system.tbl_applications
     SET estado = CASE WHEN estado = 'AI' THEN 'IN' ELSE 'AI' END,
         updated_at = NOW()
     WHERE id = $1 AND estado_registro = 'O'
     RETURNING id, code, name, estado`,
    [id]
  );
  return rows[0] || null;
}

async function softDelete(id) {
  const { rows } = await query(
    `UPDATE sch_system.tbl_applications
     SET estado_registro = 'X', estado = 'IN', updated_at = NOW()
     WHERE id = $1 AND estado_registro = 'O'
     RETURNING id, code, name`,
    [id]
  );
  return rows[0] || null;
}

module.exports = {
  findAll, findById, existsByCode, countCredentials,
  create, update, toggleEstado, softDelete,
};
