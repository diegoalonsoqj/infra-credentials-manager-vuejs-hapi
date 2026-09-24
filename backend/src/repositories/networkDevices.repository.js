'use strict';

const { query } = require('../config/database');
const { likePattern } = require('../utils/sqlLike');

// =============================================================================
// networkDevices.repository.js — Queries para tbl_network_devices.
// Modelo plano, como tbl_servers: un registro = un dispositivo en un ambiente.
// Soft delete siempre (estado_registro='X').
// =============================================================================

const SELECT_COLUMNS = `
       n.id, n.code, n.name, n.host, n.port, n.description,
       n.estado, n.estado_registro, n.created_at, n.updated_at,
       n.environment_id, n.infrastructure_id, n.product_id,
       e.code   AS environment_code,    e.name   AS environment_name, e.prd_flag,
       inf.code AS infrastructure_code, inf.name AS infrastructure_name,
       np.code  AS product_code,        np.name  AS product_name`;

const FROM_JOINS = `
     FROM sch_system.tbl_network_devices n
     JOIN sch_system.tbl_environment              e   ON e.id   = n.environment_id
     LEFT JOIN sch_system.tbl_infrastructure      inf ON inf.id = n.infrastructure_id
     LEFT JOIN sch_system.tbl_cat_network_product np  ON np.id  = n.product_id`;

async function findAll({ page = 1, limit = 20, search = '', environmentId = null, infrastructureId = null, productId = null } = {}) {
  const offset      = (page - 1) * limit;
  const searchParam = likePattern(search);

  const { rows } = await query(
    `SELECT ${SELECT_COLUMNS}
     ${FROM_JOINS}
     WHERE n.estado_registro = 'O'
       AND ($3::text IS NULL OR (LOWER(n.code) LIKE $3 OR LOWER(n.name) LIKE $3 OR LOWER(n.host) LIKE $3))
       AND ($4::int  IS NULL OR n.environment_id    = $4)
       AND ($5::int  IS NULL OR n.infrastructure_id = $5)
       AND ($6::int  IS NULL OR n.product_id        = $6)
     ORDER BY n.name ASC
     LIMIT $1 OFFSET $2`,
    [limit, offset, searchParam, environmentId || null, infrastructureId || null, productId || null]
  );

  const { rows: countRows } = await query(
    `SELECT COUNT(*) AS total
     FROM sch_system.tbl_network_devices n
     WHERE n.estado_registro = 'O'
       AND ($1::text IS NULL OR (LOWER(n.code) LIKE $1 OR LOWER(n.name) LIKE $1 OR LOWER(n.host) LIKE $1))
       AND ($2::int  IS NULL OR n.environment_id    = $2)
       AND ($3::int  IS NULL OR n.infrastructure_id = $3)
       AND ($4::int  IS NULL OR n.product_id        = $4)`,
    [searchParam, environmentId || null, infrastructureId || null, productId || null]
  );

  return { devices: rows, total: parseInt(countRows[0].total, 10), page, limit };
}

async function findById(id) {
  const { rows } = await query(
    `SELECT ${SELECT_COLUMNS}
     ${FROM_JOINS}
     WHERE n.id = $1 AND n.estado_registro = 'O'`,
    [id]
  );
  return rows[0] || null;
}

async function countCredentials(deviceId) {
  const { rows } = await query(
    `SELECT COUNT(*) AS total FROM sch_secret.tbl_credentials
     WHERE network_device_id = $1 AND estado_registro = 'O'`,
    [deviceId]
  );
  return parseInt(rows[0].total, 10);
}

async function create({ name, host, port, infrastructureId, environmentId, productId, description, createdBy }) {
  const { rows: [ins] } = await query(
    `INSERT INTO sch_system.tbl_network_devices
       (code, name, host, port, infrastructure_id, environment_id, product_id, description, created_by)
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, environment_id`,
    [
      name.trim(), host.trim(),
      port             || null,
      infrastructureId || null,
      environmentId,
      productId        || null,
      description      || null,
      createdBy,
    ]
  );
  // Código definitivo NET-{AMBIENTE}-{NNNN}, como SRV- y APP-.
  const { rows } = await query(
    `UPDATE sch_system.tbl_network_devices
     SET code = 'NET-' || e.code || '-' || LPAD($1::text, 4, '0')
     FROM sch_system.tbl_environment e
     WHERE e.id = $2 AND tbl_network_devices.id = $1
     RETURNING tbl_network_devices.id, tbl_network_devices.code,
               tbl_network_devices.name, tbl_network_devices.host, tbl_network_devices.port`,
    [ins.id, ins.environment_id]
  );
  return rows[0];
}

async function update(id, { name, host, port, infrastructureId, environmentId, productId, description }) {
  const { rows } = await query(
    `UPDATE sch_system.tbl_network_devices
     SET name              = $2,
         host              = $3,
         port              = $4,
         infrastructure_id = $5,
         environment_id    = $6,
         product_id        = $7,
         description       = $8,
         updated_at        = NOW()
     WHERE id = $1 AND estado_registro = 'O'
     RETURNING id, code, name, host, port`,
    [
      id,
      name.trim(), host.trim(),
      port             || null,
      infrastructureId || null,
      environmentId,
      productId        || null,
      description      || null,
    ]
  );
  return rows[0] || null;
}

async function toggleEstado(id) {
  const { rows } = await query(
    `UPDATE sch_system.tbl_network_devices
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
    `UPDATE sch_system.tbl_network_devices
     SET estado_registro = 'X', estado = 'IN', updated_at = NOW()
     WHERE id = $1 AND estado_registro = 'O'
     RETURNING id, code, name`,
    [id]
  );
  return rows[0] || null;
}

async function findAllNetworkProducts() {
  const { rows } = await query(
    `SELECT id, code, name, sort_order
     FROM sch_system.tbl_cat_network_product
     WHERE estado_registro = 'O' AND estado = 'AI'
     ORDER BY sort_order, name`
  );
  return rows;
}

module.exports = {
  findAll, findById, countCredentials,
  create, update, toggleEstado, softDelete,
  findAllNetworkProducts,
};
