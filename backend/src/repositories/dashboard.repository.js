'use strict';

const { query } = require('../config/database');

// =============================================================================
// dashboard.repository.js — Queries de estadísticas para el Dashboard.
// =============================================================================

/**
 * Conteos de credenciales por tipo y custodia.
 *
 * AMBITO: null = sin restriccion (ADMIN). Un array = solo esos tipos, y el
 * array VACIO significa NINGUNO, no "todos": `resource_type = ANY('{}')` no
 * devuelve filas. Tratarlo como "sin restriccion" —que es lo que hacia el
 * `length > 0`— le daba a un VISITOR, que no tiene ningun tipo asignado,
 * exactamente los mismos totales que a un ADMIN. Es el mismo criterio que
 * getResourceTypesForUser() aplica en credentials.service.js.
 */
async function getCredentialStats(resourceTypes = null) {
  const filter = resourceTypes
    ? `AND c.resource_type = ANY($1::text[])`
    : '';
  const params = resourceTypes ? [resourceTypes] : [];

  const { rows } = await query(
    `SELECT
       COUNT(*)                                                      AS total,
       COUNT(*) FILTER (WHERE c.is_custodied)                       AS custodied,
       COUNT(*) FILTER (WHERE c.resource_type = 'DB')               AS db_total,
       COUNT(*) FILTER (WHERE c.resource_type = 'OS')               AS os_total,
       COUNT(*) FILTER (WHERE c.resource_type = 'APP')              AS app_total,
       COUNT(*) FILTER (WHERE c.resource_type = 'NET')              AS net_total,
       COUNT(*) FILTER (WHERE c.resource_type = 'DB' AND c.is_custodied) AS db_custodied,
       COUNT(*) FILTER (WHERE c.resource_type = 'OS' AND c.is_custodied) AS os_custodied,
       COUNT(*) FILTER (WHERE c.resource_type = 'APP' AND c.is_custodied) AS app_custodied,
       COUNT(*) FILTER (WHERE c.resource_type = 'NET' AND c.is_custodied) AS net_custodied
     FROM sch_secret.tbl_credentials c
     WHERE c.estado_registro = 'O' AND c.estado = 'AI'
     ${filter}`,
    params
  );

  const r = rows[0];
  return {
    total:        parseInt(r.total, 10),
    custodied:    parseInt(r.custodied, 10),
    dbTotal:      parseInt(r.db_total, 10),
    osTotal:      parseInt(r.os_total, 10),
    appTotal:     parseInt(r.app_total, 10),
    netTotal:     parseInt(r.net_total, 10),
    dbCustodied:  parseInt(r.db_custodied, 10),
    osCustodied:  parseInt(r.os_custodied, 10),
    appCustodied: parseInt(r.app_custodied, 10),
    netCustodied: parseInt(r.net_custodied, 10),
  };
}

/**
 * Últimas N acciones del log de auditoría.
 *
 * Si se pasa userId, solo devuelve las acciones de ESE usuario. El widget del
 * dashboard lo usa para quien no tiene MOD_AUDIT: sin el filtro, cualquier
 * sesión —incluido un VISITOR, que por definición no accede a credenciales—
 * leía quién había descifrado qué y sobre qué recurso productivo, rodeando el
 * permiso que protege GET /api/audit.
 *
 * Las columnas son las mismas en ambos casos: el widget no distingue.
 */
async function getRecentActivity(limit = 8, userId = null) {
  const { rows } = await query(
    `SELECT
       a.action,
       a.username,
       a.resource_type,
       a.resource_name,
       a.result,
       a.created_at
     FROM sch_audit.tbl_audit_log a
     WHERE ($2::uuid IS NULL OR a.user_id = $2)
     ORDER BY a.created_at DESC
     LIMIT $1`,
    [limit, userId]
  );
  return rows;
}

/**
 * Conteo de credenciales activas agrupadas por ambiente.
 *
 * Acota por tipo de recurso igual que getCredentialStats: el ámbito de equipo
 * se aplicaba a los KPIs pero no a este desglose, así que un usuario de un solo
 * equipo veía el reparto por ambiente de TODAS las credenciales del sistema.
 */
async function getCredentialsByEnvironment(resourceTypes = null) {
  const filtro = resourceTypes
    ? `AND c.resource_type = ANY($1::text[])`
    : '';
  const params = resourceTypes ? [resourceTypes] : [];

  const { rows } = await query(
    `SELECT
       COALESCE(es.name, ed.name, ea.name, en.name) AS env_name,
       COALESCE(es.code, ed.code, ea.code, en.code) AS env_code,
       COALESCE(es.prd_flag, ed.prd_flag, ea.prd_flag, en.prd_flag, false) AS prd_flag,
       COUNT(*)::int                                AS total
     FROM sch_secret.tbl_credentials c
     LEFT JOIN sch_system.tbl_servers       s   ON s.id  = c.server_id
     LEFT JOIN sch_system.tbl_environment   es  ON es.id = s.environment_id
     LEFT JOIN sch_system.tbl_db_services   d   ON d.id  = c.db_service_id
     LEFT JOIN sch_system.tbl_environment   ed  ON ed.id = d.environment_id
     LEFT JOIN sch_system.tbl_applications  a   ON a.id  = c.application_id
     LEFT JOIN sch_system.tbl_environment   ea  ON ea.id = a.environment_id
     LEFT JOIN sch_system.tbl_network_devices n ON n.id = c.network_device_id
     LEFT JOIN sch_system.tbl_environment   en  ON en.id = n.environment_id
     WHERE c.estado_registro = 'O' AND c.estado = 'AI'
     ${filtro}
     GROUP BY env_name, env_code, COALESCE(es.prd_flag, ed.prd_flag, ea.prd_flag, en.prd_flag, false)
     ORDER BY COALESCE(es.prd_flag, ed.prd_flag, ea.prd_flag, en.prd_flag, false) DESC, total DESC
     LIMIT 10`,
    params
  );
  return rows;
}

module.exports = { getCredentialStats, getRecentActivity, getCredentialsByEnvironment };
