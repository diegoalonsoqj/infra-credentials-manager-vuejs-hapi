'use strict';

const { query } = require('../config/database');
const { likePattern } = require('../utils/sqlLike');

// =============================================================================
// audit.repository.js — Consultas de solo lectura al log de auditoría.
//
// REGLAS ABSOLUTAS:
//   1. NUNCA endpoints de escritura, edición ni borrado sobre tbl_audit_log.
//   2. La tabla es inmutable: los registros son historia permanente del sistema.
//   3. Todos los filtros van como parámetros ($N), nunca interpolados.
// =============================================================================

const SELECT_COLS = `
  id, user_id, username,
  action, resource_type, resource_id, resource_name,
  environment_code, infrastructure_code,
  ip_address, result, fail_reason,
  is_prd_access, is_custodied_access, extra_data,
  created_at
`;

// Fecha sin hora, tal como la envía el <input type="date"> del visor.
const SOLO_FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Condición del límite superior del filtro de fechas.
 *
 * Una fecha sin hora se toma como el DÍA COMPLETO. Antes se comparaba
 * `created_at <= '2026-09-06'`, y PostgreSQL interpreta esa fecha como las
 * 00:00 de ese día: "hasta el 6" dejaba fuera el propio día 6. Medido sobre la
 * base real, un día con 27 eventos devolvía 0 al filtrar desde=hasta=ese día.
 * Quien investigaba un incidente filtrando por el día en que ocurrió veía el
 * log vacío.
 *
 * `$n::date + 1` es la medianoche del día siguiente en la zona horaria de la
 * sesión, la misma con la que ya se interpretaba el límite inferior. Si llega
 * fecha con hora (el esquema de la ruta lo admite), se respeta ese instante.
 *
 * @param {string} dateTo - Valor ya validado por la ruta.
 * @param {number} paramIndex - Posición del parámetro ($n).
 * @returns {string} Fragmento SQL.
 */
function dateToCondition(dateTo, paramIndex) {
  return SOLO_FECHA_RE.test(dateTo)
    ? `created_at < ($${paramIndex}::date + 1)`
    : `created_at <= $${paramIndex}`;
}

/**
 * Lista paginada del log con filtros.
 *
 * @param {object} opts
 * @param {{resourceTypes: string[], userId: string}|null} [opts.scope]
 *        null = log completo (MOD_AUDIT). Con ámbito: eventos de esos tipos de
 *        recurso O del propio usuario. Se combina con AND con el resto de
 *        filtros, así que ninguno puede sacar filas de fuera del ámbito.
 * @param {number}  opts.page
 * @param {number}  opts.limit
 * @param {string}  opts.username      - Búsqueda parcial por username
 * @param {string}  opts.action        - Filtro exacto de acción
 * @param {string}  opts.resourceType  - DB|OS|SYS
 * @param {string}  opts.result        - S|F
 * @param {boolean} opts.isPrdAccess   - true = solo accesos PRD
 * @param {string}  opts.dateFrom      - ISO 8601
 * @param {string}  opts.dateTo        - ISO 8601
 */
async function findAll({
  page = 1, limit = 30, scope = null,
  username, action, resourceType, result, isPrdAccess, dateFrom, dateTo,
} = {}) {
  const offset = (page - 1) * limit;
  const params = [];
  const where  = [];

  if (scope) {
    // resource_type es CHAR(3): al compararlo con text se quitan los espacios
    // de relleno ('DB ' = 'DB'), igual que en el filtro por tipo de abajo.
    params.push(scope.resourceTypes || []);
    params.push(scope.userId);
    where.push(`(resource_type = ANY($${params.length - 1}::text[]) OR user_id = $${params.length}::uuid)`);
  }

  // likePattern() escapa los comodines y descarta lo que no sea texto
  // utilizable (un array de la query string, por ejemplo).
  const usernamePattern = likePattern(username);
  if (usernamePattern) {
    params.push(usernamePattern);
    where.push(`LOWER(username) LIKE $${params.length} ESCAPE '\\'`);
  }
  if (action) {
    params.push(action);
    where.push(`action = $${params.length}`);
  }
  if (resourceType) {
    params.push(resourceType);
    where.push(`resource_type = $${params.length}`);
  }
  if (result) {
    params.push(result);
    where.push(`result = $${params.length}`);
  }
  if (isPrdAccess === true || isPrdAccess === 'true') {
    where.push(`is_prd_access = TRUE`);
  }
  if (dateFrom) {
    params.push(dateFrom);
    where.push(`created_at >= $${params.length}`);
  }
  if (dateTo) {
    params.push(dateTo);
    where.push(dateToCondition(dateTo, params.length));
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // Pagination params
  params.push(limit);
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;

  const { rows } = await query(
    `SELECT ${SELECT_COLS}
     FROM sch_audit.tbl_audit_log
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params
  );

  // Count — reusar mismos filtros sin LIMIT/OFFSET
  const countParams = params.slice(0, -2);
  const { rows: countRows } = await query(
    `SELECT COUNT(*) AS total
     FROM sch_audit.tbl_audit_log
     ${whereClause}`,
    countParams
  );

  return {
    records: rows,
    total:   parseInt(countRows[0].total, 10),
    page,
    limit,
  };
}

/**
 * Lista paginada filtrada por usuario (para non-ADMIN).
 */
async function findByUser(userId, {
  page = 1, limit = 30,
  action, result, dateFrom, dateTo,
} = {}) {
  const offset = (page - 1) * limit;
  const params = [userId];
  const where  = [`user_id = $1`];

  if (action) {
    params.push(action);
    where.push(`action = $${params.length}`);
  }
  if (result) {
    params.push(result);
    where.push(`result = $${params.length}`);
  }
  if (dateFrom) {
    params.push(dateFrom);
    where.push(`created_at >= $${params.length}`);
  }
  if (dateTo) {
    params.push(dateTo);
    where.push(dateToCondition(dateTo, params.length));
  }

  const whereClause = `WHERE ${where.join(' AND ')}`;

  params.push(limit);
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;

  const { rows } = await query(
    `SELECT ${SELECT_COLS}
     FROM sch_audit.tbl_audit_log
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params
  );

  const countParams = params.slice(0, -2);
  const { rows: countRows } = await query(
    `SELECT COUNT(*) AS total
     FROM sch_audit.tbl_audit_log
     ${whereClause}`,
    countParams
  );

  return {
    records: rows,
    total:   parseInt(countRows[0].total, 10),
    page,
    limit,
  };
}

/**
 * Últimas N acciones del usuario (para el widget del Dashboard).
 */
async function findRecentByUser(userId, limit = 10) {
  const { rows } = await query(
    `SELECT id, action, result, ip_address, created_at, fail_reason
     FROM sch_audit.tbl_audit_log
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, Math.min(limit, 50)]
  );
  return rows;
}

/**
 * Lista de acciones distintas presentes en el log (para filtros).
 */
async function findDistinctActions() {
  const { rows } = await query(
    `SELECT DISTINCT action FROM sch_audit.tbl_audit_log ORDER BY action`
  );
  return rows.map((r) => r.action);
}

module.exports = {
  findAll,
  findByUser,
  findRecentByUser,
  findDistinctActions,
};
