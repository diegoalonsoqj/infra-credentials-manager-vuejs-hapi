'use strict';

const { query } = require('../config/database');
const { likePattern } = require('../utils/sqlLike');

// =============================================================================
// resources.repository.js — Queries para tbl_servers y tbl_db_services.
// Modelo plano: un registro = un recurso en un ambiente específico.
// Sin tablas de instancias. Soft delete siempre (estado_registro='X').
// =============================================================================

// ---------------------------------------------------------------------------
// Catálogos compartidos (selects para formularios)
// ---------------------------------------------------------------------------

async function findAllEnvironments() {
  const { rows } = await query(
    `SELECT id, code, name, prd_flag, sort_order
     FROM sch_system.tbl_environment
     WHERE estado_registro = 'O' AND estado = 'AI'
     ORDER BY sort_order`
  );
  return rows;
}

async function findAllInfrastructures() {
  const { rows } = await query(
    `SELECT id, code, name, description
     FROM sch_system.tbl_infrastructure
     WHERE estado_registro = 'O' AND estado = 'AI'
     ORDER BY name`
  );
  return rows;
}

async function findAllOsTypes() {
  const { rows } = await query(
    `SELECT id, code, name, sort_order
     FROM sch_system.tbl_cat_os
     WHERE estado_registro = 'O' AND estado = 'AI'
     ORDER BY sort_order, name`
  );
  return rows;
}

async function findAllServerProducts() {
  const { rows } = await query(
    `SELECT id, code, name, sort_order
     FROM sch_system.tbl_cat_server_product
     WHERE estado_registro = 'O' AND estado = 'AI'
     ORDER BY sort_order, name`
  );
  return rows;
}

async function findAllDbProducts() {
  const { rows } = await query(
    `SELECT id, code, name, sort_order
     FROM sch_system.tbl_cat_db_product
     WHERE estado_registro = 'O' AND estado = 'AI'
     ORDER BY sort_order, name`
  );
  return rows;
}

async function findAllDbEngines() {
  const { rows } = await query(
    `SELECT id, code, name, sort_order
     FROM sch_system.tbl_cat_db_engine
     WHERE estado_registro = 'O' AND estado = 'AI'
     ORDER BY sort_order, name`
  );
  return rows;
}

async function findAllProjects(infrastructureId = null) {
  const { rows } = await query(
    `SELECT p.id, p.code, p.name, p.sort_order, p.infrastructure_id,
            i.code AS infrastructure_code, i.name AS infrastructure_name
     FROM sch_system.tbl_cat_project p
     LEFT JOIN sch_system.tbl_infrastructure i ON i.id = p.infrastructure_id
     WHERE p.estado_registro = 'O' AND p.estado = 'AI'
       AND ($1::int IS NULL OR p.infrastructure_id = $1)
     ORDER BY p.sort_order, p.name`,
    [infrastructureId || null]
  );
  return rows;
}

// ---------------------------------------------------------------------------
// tbl_servers
// ---------------------------------------------------------------------------

async function findAllServers({ page = 1, limit = 20, search = '', environmentId = null, infrastructureId = null, productId = null, osId = null } = {}) {
  const offset      = (page - 1) * limit;
  const searchParam = likePattern(search);

  const { rows } = await query(
    `SELECT
       s.id, s.code, s.hostname, s.name, s.ip_address::text,
       s.project_id, s.description, s.owner_team_id,
       s.estado, s.estado_registro, s.created_at, s.updated_at,
       e.id   AS environment_id,   e.code AS environment_code,   e.name AS environment_name, e.prd_flag,
       inf.id AS infrastructure_id, inf.code AS infrastructure_code, inf.name AS infrastructure_name,
       os.id  AS os_id,  os.code AS os_code,  os.name AS os_name,
       sp.id  AS product_id, sp.code AS product_code, sp.name AS product_name,
       prj.id AS project_id, prj.code AS project_code, prj.name AS project_name
     FROM sch_system.tbl_servers s
     JOIN sch_system.tbl_environment         e   ON e.id   = s.environment_id
     LEFT JOIN sch_system.tbl_infrastructure inf ON inf.id = s.infrastructure_id
     LEFT JOIN sch_system.tbl_cat_os         os  ON os.id  = s.os_id
     LEFT JOIN sch_system.tbl_cat_server_product sp  ON sp.id  = s.product_id
     LEFT JOIN sch_system.tbl_cat_project        prj ON prj.id = s.project_id
     WHERE s.estado_registro = 'O'
       AND ($3::text IS NULL OR (LOWER(s.code) LIKE $3 OR LOWER(s.name) LIKE $3 OR LOWER(s.hostname) LIKE $3))
       AND ($4::int  IS NULL OR s.environment_id    = $4)
       AND ($5::int  IS NULL OR s.infrastructure_id = $5)
       AND ($6::int  IS NULL OR s.product_id        = $6)
       AND ($7::int  IS NULL OR s.os_id             = $7)
     ORDER BY s.name ASC
     LIMIT $1 OFFSET $2`,
    [limit, offset, searchParam, environmentId || null, infrastructureId || null, productId || null, osId || null]
  );

  const { rows: countRows } = await query(
    `SELECT COUNT(*) AS total
     FROM sch_system.tbl_servers s
     WHERE s.estado_registro = 'O'
       AND ($1::text IS NULL OR (LOWER(s.code) LIKE $1 OR LOWER(s.name) LIKE $1 OR LOWER(s.hostname) LIKE $1))
       AND ($2::int  IS NULL OR s.environment_id    = $2)
       AND ($3::int  IS NULL OR s.infrastructure_id = $3)
       AND ($4::int  IS NULL OR s.product_id        = $4)
       AND ($5::int  IS NULL OR s.os_id             = $5)`,
    [searchParam, environmentId || null, infrastructureId || null, productId || null, osId || null]
  );

  return { servers: rows, total: parseInt(countRows[0].total, 10), page, limit };
}

async function findServerById(id) {
  const { rows } = await query(
    `SELECT
       s.id, s.code, s.hostname, s.name, s.ip_address::text,
       s.project_id, s.description, s.owner_team_id,
       s.estado, s.estado_registro, s.created_at, s.updated_at,
       s.environment_id, s.infrastructure_id, s.os_id, s.product_id,
       e.code AS environment_code,   e.name AS environment_name, e.prd_flag,
       inf.code AS infrastructure_code, inf.name AS infrastructure_name,
       os.code AS os_code,  os.name AS os_name,
       sp.code AS product_code, sp.name AS product_name,
       prj.code AS project_code, prj.name AS project_name
     FROM sch_system.tbl_servers s
     JOIN sch_system.tbl_environment         e   ON e.id   = s.environment_id
     LEFT JOIN sch_system.tbl_infrastructure inf ON inf.id = s.infrastructure_id
     LEFT JOIN sch_system.tbl_cat_os         os  ON os.id  = s.os_id
     LEFT JOIN sch_system.tbl_cat_server_product sp  ON sp.id  = s.product_id
     LEFT JOIN sch_system.tbl_cat_project        prj ON prj.id = s.project_id
     WHERE s.id = $1 AND s.estado_registro = 'O'`,
    [id]
  );
  return rows[0] || null;
}

async function existsServerByCode(code, excludeId = null) {
  const { rows } = await query(
    `SELECT id FROM sch_system.tbl_servers
     WHERE LOWER(code) = LOWER($1) AND estado_registro = 'O'
       AND ($2::int IS NULL OR id != $2)`,
    [code, excludeId]
  );
  return rows.length > 0;
}

async function countCredentialsByServer(serverId) {
  const { rows } = await query(
    `SELECT COUNT(*) AS total FROM sch_secret.tbl_credentials
     WHERE server_id = $1 AND estado_registro = 'O'`,
    [serverId]
  );
  return parseInt(rows[0].total, 10);
}

async function createServer({ hostname, name, ipAddress, infrastructureId, environmentId, projectId, productId, osId, description, createdBy, ownerTeamId }) {
  const { rows: [ins] } = await query(
    `INSERT INTO sch_system.tbl_servers
       (code, hostname, name, ip_address, infrastructure_id, environment_id,
        project_id, product_id, os_id, description, created_by, owner_team_id)
     VALUES (gen_random_uuid()::text, $1, $2, $3::inet, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id, environment_id`,
    [
      hostname.trim(), name.trim(),
      ipAddress          || null,
      infrastructureId   || null,
      environmentId,
      projectId          || null,
      productId          || null,
      osId               || null,
      description        || null,
      createdBy,
      ownerTeamId        || null,
    ]
  );
  const { rows } = await query(
    `UPDATE sch_system.tbl_servers
     SET code = 'SRV-' || e.code || '-' || LPAD($1::text, 4, '0')
     FROM sch_system.tbl_environment e
     WHERE e.id = $2 AND tbl_servers.id = $1
     RETURNING tbl_servers.id, tbl_servers.code, tbl_servers.hostname,
               tbl_servers.name, tbl_servers.ip_address::text`,
    [ins.id, ins.environment_id]
  );
  return rows[0];
}

async function updateServer(id, { hostname, name, ipAddress, infrastructureId, environmentId, projectId, productId, osId, description }) {
  const { rows } = await query(
    `UPDATE sch_system.tbl_servers
     SET hostname           = $2,
         name               = $3,
         ip_address         = $4::inet,
         infrastructure_id  = $5,
         environment_id     = $6,
         project_id         = $7,
         product_id         = $8,
         os_id              = $9,
         description        = $10,
         updated_at         = NOW()
     WHERE id = $1 AND estado_registro = 'O'
     RETURNING id, code, hostname, name, ip_address::text`,
    [
      id,
      hostname.trim(), name.trim(),
      ipAddress          || null,
      infrastructureId   || null,
      environmentId,
      projectId          || null,
      productId          || null,
      osId               || null,
      description        || null,
    ]
  );
  return rows[0] || null;
}

async function toggleServerEstado(id) {
  const { rows } = await query(
    `UPDATE sch_system.tbl_servers
     SET estado = CASE WHEN estado = 'AI' THEN 'IN' ELSE 'AI' END,
         updated_at = NOW()
     WHERE id = $1 AND estado_registro = 'O'
     RETURNING id, code, name, estado`,
    [id]
  );
  return rows[0] || null;
}

async function softDeleteServer(id) {
  const { rows } = await query(
    `UPDATE sch_system.tbl_servers
     SET estado_registro = 'X', estado = 'IN', updated_at = NOW()
     WHERE id = $1 AND estado_registro = 'O'
     RETURNING id, code, name`,
    [id]
  );
  return rows[0] || null;
}

// Lista plana de servidores activos para selects (usado en db_services y applications)
async function findServersForSelect() {
  const { rows } = await query(
    `SELECT s.id, s.code, s.name, s.hostname, s.ip_address::text,
            e.code AS environment_code, e.name AS environment_name
     FROM sch_system.tbl_servers s
     JOIN sch_system.tbl_environment e ON e.id = s.environment_id
     WHERE s.estado_registro = 'O' AND s.estado = 'AI'
     ORDER BY e.sort_order, s.name`
  );
  return rows;
}

// ---------------------------------------------------------------------------
// tbl_db_services
// ---------------------------------------------------------------------------

async function findAllDbServices({ page = 1, limit = 20, search = '', environmentId = null, engineId = null, estado = null, productId = null, infrastructureId = null } = {}) {
  const offset      = (page - 1) * limit;
  const searchParam = likePattern(search);

  const { rows } = await query(
    `SELECT
       d.id, d.code, d.name, d.host, d.port, d.project_id, d.description, d.owner_team_id,
       d.estado, d.estado_registro, d.created_at, d.updated_at,
       e.id   AS environment_id,   e.code AS environment_code,   e.name AS environment_name, e.prd_flag,
       inf.id AS infrastructure_id, inf.code AS infrastructure_code, inf.name AS infrastructure_name,
       dp.id  AS product_id, dp.code AS product_code, dp.name AS product_name,
       de.id  AS engine_id,  de.code AS engine_code,  de.name AS engine_name,
       s.id   AS server_id,  s.code AS server_code,   s.name AS server_name, s.hostname AS server_hostname,
       prj.id AS project_id, prj.code AS project_code, prj.name AS project_name
     FROM sch_system.tbl_db_services d
     JOIN sch_system.tbl_environment            e   ON e.id   = d.environment_id
     LEFT JOIN sch_system.tbl_infrastructure    inf ON inf.id = d.infrastructure_id
     LEFT JOIN sch_system.tbl_cat_db_product    dp  ON dp.id  = d.product_id
     LEFT JOIN sch_system.tbl_cat_db_engine     de  ON de.id  = d.engine_id
     LEFT JOIN sch_system.tbl_servers           s   ON s.id   = d.server_id
     LEFT JOIN sch_system.tbl_cat_project       prj ON prj.id = d.project_id
     WHERE d.estado_registro = 'O'
       AND ($3::text IS NULL OR (LOWER(d.code) LIKE $3 OR LOWER(d.name) LIKE $3 OR LOWER(d.host) LIKE $3))
       AND ($4::int  IS NULL OR d.environment_id    = $4)
       AND ($5::int  IS NULL OR d.engine_id         = $5)
       AND ($6::text IS NULL OR d.estado            = $6)
       AND ($7::int  IS NULL OR d.product_id        = $7)
       AND ($8::int  IS NULL OR d.infrastructure_id = $8)
     ORDER BY d.name ASC
     LIMIT $1 OFFSET $2`,
    [limit, offset, searchParam, environmentId || null, engineId || null, estado || null, productId || null, infrastructureId || null]
  );

  const { rows: countRows } = await query(
    `SELECT COUNT(*) AS total
     FROM sch_system.tbl_db_services d
     WHERE d.estado_registro = 'O'
       AND ($1::text IS NULL OR (LOWER(d.code) LIKE $1 OR LOWER(d.name) LIKE $1 OR LOWER(d.host) LIKE $1))
       AND ($2::int  IS NULL OR d.environment_id    = $2)
       AND ($3::int  IS NULL OR d.engine_id         = $3)
       AND ($4::text IS NULL OR d.estado            = $4)
       AND ($5::int  IS NULL OR d.product_id        = $5)
       AND ($6::int  IS NULL OR d.infrastructure_id = $6)`,
    [searchParam, environmentId || null, engineId || null, estado || null, productId || null, infrastructureId || null]
  );

  return { dbServices: rows, total: parseInt(countRows[0].total, 10), page, limit };
}

async function findDbServiceById(id) {
  const { rows } = await query(
    `SELECT
       d.id, d.code, d.name, d.host, d.port, d.project_id, d.description, d.owner_team_id,
       d.estado, d.estado_registro, d.created_at, d.updated_at,
       d.environment_id, d.infrastructure_id, d.product_id, d.engine_id, d.server_id,
       e.code AS environment_code,   e.name AS environment_name, e.prd_flag,
       inf.code AS infrastructure_code, inf.name AS infrastructure_name,
       dp.code AS product_code, dp.name AS product_name,
       de.code AS engine_code,  de.name AS engine_name,
       s.code AS server_code, s.name AS server_name, s.hostname AS server_hostname,
       prj.code AS project_code, prj.name AS project_name
     FROM sch_system.tbl_db_services d
     JOIN sch_system.tbl_environment            e   ON e.id   = d.environment_id
     LEFT JOIN sch_system.tbl_infrastructure    inf ON inf.id = d.infrastructure_id
     LEFT JOIN sch_system.tbl_cat_db_product    dp  ON dp.id  = d.product_id
     LEFT JOIN sch_system.tbl_cat_db_engine     de  ON de.id  = d.engine_id
     LEFT JOIN sch_system.tbl_servers           s   ON s.id   = d.server_id
     LEFT JOIN sch_system.tbl_cat_project       prj ON prj.id = d.project_id
     WHERE d.id = $1 AND d.estado_registro = 'O'`,
    [id]
  );
  return rows[0] || null;
}

async function existsDbServiceByCode(code, excludeId = null) {
  const { rows } = await query(
    `SELECT id FROM sch_system.tbl_db_services
     WHERE LOWER(code) = LOWER($1) AND estado_registro = 'O'
       AND ($2::int IS NULL OR id != $2)`,
    [code, excludeId]
  );
  return rows.length > 0;
}

async function countCredentialsByDbService(dbServiceId) {
  const { rows } = await query(
    `SELECT COUNT(*) AS total FROM sch_secret.tbl_credentials
     WHERE db_service_id = $1 AND estado_registro = 'O'`,
    [dbServiceId]
  );
  return parseInt(rows[0].total, 10);
}

async function createDbService({ name, host, port, infrastructureId, environmentId, projectId, productId, engineId, serverId, description, createdBy, ownerTeamId }) {
  const { rows: [ins] } = await query(
    `INSERT INTO sch_system.tbl_db_services
       (code, name, host, port, infrastructure_id, environment_id,
        project_id, product_id, engine_id, server_id, description, created_by, owner_team_id)
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id, environment_id`,
    [
      name.trim(), host.trim(),
      port               || null,
      infrastructureId   || null,
      environmentId,
      projectId          || null,
      productId          || null,
      engineId           || null,
      serverId           || null,
      description        || null,
      createdBy,
      ownerTeamId        || null,
    ]
  );
  const { rows } = await query(
    `UPDATE sch_system.tbl_db_services
     SET code = 'DB-' || e.code || '-' || LPAD($1::text, 4, '0')
     FROM sch_system.tbl_environment e
     WHERE e.id = $2 AND tbl_db_services.id = $1
     RETURNING tbl_db_services.id, tbl_db_services.code,
               tbl_db_services.name, tbl_db_services.host, tbl_db_services.port`,
    [ins.id, ins.environment_id]
  );
  return rows[0];
}

async function updateDbService(id, { name, host, port, infrastructureId, environmentId, projectId, productId, engineId, serverId, description }) {
  const { rows } = await query(
    `UPDATE sch_system.tbl_db_services
     SET name               = $2,
         host               = $3,
         port               = $4,
         infrastructure_id  = $5,
         environment_id     = $6,
         project_id         = $7,
         product_id         = $8,
         engine_id          = $9,
         server_id          = $10,
         description        = $11,
         updated_at         = NOW()
     WHERE id = $1 AND estado_registro = 'O'
     RETURNING id, code, name, host, port`,
    [
      id,
      name.trim(), host.trim(),
      port               || null,
      infrastructureId   || null,
      environmentId,
      projectId          || null,
      productId          || null,
      engineId           || null,
      serverId           || null,
      description        || null,
    ]
  );
  return rows[0] || null;
}

async function toggleDbServiceEstado(id) {
  const { rows } = await query(
    `UPDATE sch_system.tbl_db_services
     SET estado = CASE WHEN estado = 'AI' THEN 'IN' ELSE 'AI' END,
         updated_at = NOW()
     WHERE id = $1 AND estado_registro = 'O'
     RETURNING id, code, name, estado`,
    [id]
  );
  return rows[0] || null;
}

async function softDeleteDbService(id) {
  const { rows } = await query(
    `UPDATE sch_system.tbl_db_services
     SET estado_registro = 'X', estado = 'IN', updated_at = NOW()
     WHERE id = $1 AND estado_registro = 'O'
     RETURNING id, code, name`,
    [id]
  );
  return rows[0] || null;
}

module.exports = {
  // Catálogos
  findAllEnvironments,
  findAllInfrastructures,
  findAllOsTypes,
  findAllServerProducts,
  findAllDbProducts,
  findAllDbEngines,
  findAllProjects,
  findServersForSelect,
  // Servers
  findAllServers,
  findServerById,
  existsServerByCode,
  countCredentialsByServer,
  createServer,
  updateServer,
  toggleServerEstado,
  softDeleteServer,
  // DB Services
  findAllDbServices,
  findDbServiceById,
  existsDbServiceByCode,
  countCredentialsByDbService,
  createDbService,
  updateDbService,
  toggleDbServiceEstado,
  softDeleteDbService,
};
