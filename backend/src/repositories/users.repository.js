'use strict';

const { query, withTransaction } = require('../config/database');
const { likePattern } = require('../utils/sqlLike');

// =============================================================================
// users.repository.js — Queries de base de datos para gestión de usuarios.
// Solo accesible por ADMIN (enforced en middleware de rutas).
// Todas las queries son parametrizadas. Soft delete siempre.
// =============================================================================

/**
 * Lista todos los usuarios activos con su rol y equipo.
 */
async function findAll({ page = 1, limit = 20, search = '', roleCode = null, teamCode = null, estado = null } = {}) {
  const offset = (page - 1) * limit;
  const searchParam = likePattern(search);

  const { rows } = await query(
    `SELECT
       u.id,
       u.username,
       u.email,
       u.first_name,
       u.last_name,
       u.full_name,
       u.force_pwd_change,
       u.last_login_at,
       u.failed_attempts,
       u.locked_until,
       u.mfa_enabled,
       u.auth_source,
       u.estado,
       u.estado_registro,
       u.created_at,
       r.code  AS role,
       r.name  AS role_name,
       r.level AS role_level,
       t.code  AS team,
       t.name  AS team_name
     FROM sch_system.tbl_users u
     JOIN sch_system.tbl_roles r ON r.id = u.role_id
     LEFT JOIN sch_system.tbl_teams t ON t.id = u.team_id
     WHERE u.estado_registro = 'O'
       AND ($3::text IS NULL OR (
         LOWER(u.username)  LIKE $3 OR
         LOWER(u.email)     LIKE $3 OR
         LOWER(u.full_name) LIKE $3
       ))
       AND ($4::text IS NULL OR r.code = $4)
       AND ($5::text IS NULL OR t.code = $5)
       AND ($6::text IS NULL OR u.estado = $6)
     ORDER BY u.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset, searchParam, roleCode || null, teamCode || null, estado || null]
  );

  const { rows: countRows } = await query(
    `SELECT COUNT(*) AS total
     FROM sch_system.tbl_users u
     JOIN sch_system.tbl_roles r ON r.id = u.role_id
     LEFT JOIN sch_system.tbl_teams t ON t.id = u.team_id
     WHERE u.estado_registro = 'O'
       AND ($1::text IS NULL OR (
         LOWER(u.username)  LIKE $1 OR
         LOWER(u.email)     LIKE $1 OR
         LOWER(u.full_name) LIKE $1
       ))
       AND ($2::text IS NULL OR r.code = $2)
       AND ($3::text IS NULL OR t.code = $3)
       AND ($4::text IS NULL OR u.estado = $4)`,
    [searchParam, roleCode || null, teamCode || null, estado || null]
  );

  return {
    users: rows,
    total: parseInt(countRows[0].total, 10),
    page,
    limit,
  };
}

/**
 * Busca un usuario por ID.
 */
async function findById(id) {
  const { rows } = await query(
    `SELECT
       u.id, u.username, u.email, u.first_name, u.last_name, u.full_name,
       u.force_pwd_change, u.last_login_at,
       u.failed_attempts, u.locked_until, u.mfa_enabled, u.auth_source,
       u.estado, u.estado_registro, u.created_at, u.updated_at,
       r.id    AS role_id,
       r.code  AS role,
       r.name  AS role_name,
       r.level AS level,
       t.id   AS team_id,
       t.code AS team,
       t.name AS team_name
     FROM sch_system.tbl_users u
     JOIN sch_system.tbl_roles r ON r.id = u.role_id
     LEFT JOIN sch_system.tbl_teams t ON t.id = u.team_id
     WHERE u.id = $1 AND u.estado_registro = 'O'`,
    [id]
  );
  return rows[0] || null;
}

/**
 * Verifica si el username o email ya existe (para validación de unicidad).
 * Excluye el propio usuario al editar.
 */
async function existsByUsernameOrEmail(username, email, excludeId = null) {
  const { rows } = await query(
    `SELECT username, email FROM sch_system.tbl_users
     WHERE estado_registro = 'O'
       AND ($3::uuid IS NULL OR id != $3)
       AND (LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($2))`,
    [username, email, excludeId]
  );
  return rows;
}

/**
 * Obtiene todos los roles activos.
 */
async function findAllRoles() {
  const { rows } = await query(
    `SELECT id, code, name, level, description
     FROM sch_system.tbl_roles
     WHERE estado_registro = 'O' AND estado = 'AI'
     ORDER BY level DESC`
  );
  return rows;
}

/**
 * Obtiene todos los equipos activos.
 */
async function findAllTeams() {
  const { rows } = await query(
    `SELECT t.id, t.code, t.name,
            COALESCE(
              ARRAY_AGG(trt.resource_type ORDER BY trt.resource_type) FILTER (WHERE trt.resource_type IS NOT NULL),
              ARRAY[]::varchar[]
            ) AS resource_types
     FROM sch_system.tbl_teams t
     LEFT JOIN sch_system.tbl_team_resource_types trt ON trt.team_id = t.id
     WHERE t.estado_registro = 'O' AND t.estado = 'AI'
     GROUP BY t.id, t.code, t.name
     ORDER BY t.name`
  );
  return rows;
}

/**
 * Crea un nuevo usuario.
 *
 * Un usuario LDAP se crea sin hash y sin force_pwd_change: su contraseña es la
 * del dominio y ICM no la gestiona.
 */
async function create({ username, email, firstName, lastName, fullName, passwordHash, roleId, teamId, createdBy, authSource = 'LOCAL' }) {
  const { rows } = await query(
    `INSERT INTO sch_system.tbl_users
       (username, email, first_name, last_name, full_name, password_hash, role_id, team_id,
        force_pwd_change, estado_registro, estado, created_by, auth_source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $10 = 'LOCAL', 'O', 'AI', $9, $10)
     RETURNING id, username, email, first_name, last_name, full_name, auth_source`,
    [username, email, firstName, lastName, fullName, passwordHash || null, roleId, teamId || null, createdBy, authSource]
  );
  return rows[0];
}

/**
 * Actualiza los datos de un usuario.
 *
 * authSource cambia el origen de la contraseña en la misma sentencia:
 *   - a LDAP: se borra el hash y la marca de cambio obligatorio.
 *   - a LOCAL: exige passwordHash (temporal) y obliga a cambiarla al entrar,
 *     igual que un reseteo desde el panel.
 */
async function update(id, { email, firstName, lastName, fullName, roleId, teamId, authSource, passwordHash }) {
  const { rows } = await query(
    `UPDATE sch_system.tbl_users
     SET
       email      = $2,
       first_name = $3,
       last_name  = $4,
       full_name  = $5,
       role_id    = $6,
       team_id    = $7,
       auth_source      = COALESCE($8, auth_source),
       password_hash    = CASE WHEN $8 = 'LDAP' THEN NULL
                               WHEN $9::text IS NOT NULL THEN $9
                               ELSE password_hash END,
       force_pwd_change = CASE WHEN $8 = 'LDAP' THEN FALSE
                               WHEN $9::text IS NOT NULL THEN TRUE
                               ELSE force_pwd_change END,
       updated_at = NOW()
     WHERE id = $1 AND estado_registro = 'O'
     RETURNING id, username, email, first_name, last_name, full_name, auth_source`,
    [id, email, firstName, lastName, fullName, roleId, teamId || null, authSource || null, passwordHash || null]
  );
  return rows[0] || null;
}

/**
 * Administradores activos con contraseña LOCAL, sin contar a excludeId.
 * Debe quedar siempre al menos uno: es la forma de entrar si el directorio no
 * responde o se desactiva LDAP.
 */
async function countActiveLocalAdmins(adminLevel, excludeId = null) {
  const { rows } = await query(
    `SELECT COUNT(*) AS total
     FROM sch_system.tbl_users u
     JOIN sch_system.tbl_roles r ON r.id = u.role_id
     WHERE r.level >= $1
       AND u.estado = 'AI' AND u.estado_registro = 'O'
       AND u.auth_source = 'LOCAL'
       AND ($2::uuid IS NULL OR u.id <> $2)`,
    [adminLevel, excludeId]
  );
  return parseInt(rows[0].total, 10);
}

/**
 * Activa o desactiva un usuario (estado AI/IN). No es soft delete.
 *
 * Revoca ademas todas sus sesiones, en los DOS sentidos del cambio.
 *
 * Desactivar no las revocaba: bastaba con que la autenticacion rechaza a los
 * usuarios inactivos. Pero la sesion seguia viva en tbl_sessions y, al
 * reactivar la cuenta, cualquier sesion no caducada volvia a ser valida sola.
 * Si la cuenta se desactivo por un portatil robado, reactivarla devolvia el
 * acceso a quien lo tuviera.
 *
 * Al reactivar tambien se revoca porque un usuario inactivo no puede iniciar
 * sesion: toda sesion abierta en ese momento es anterior a la desactivacion.
 * Asi quedan cubiertas las cuentas desactivadas antes de este cambio.
 *
 * @returns {Promise<object|null>} Fila actualizada con revoked_sessions.
 */
async function setEstado(id, estado) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE sch_system.tbl_users
       SET estado = $2, updated_at = NOW()
       WHERE id = $1 AND estado_registro = 'O'
       RETURNING id, username, estado`,
      [id, estado]
    );
    if (!rows[0]) return null;

    const { rowCount } = await client.query(
      `UPDATE sch_system.tbl_sessions
       SET revoked = TRUE, revoked_at = NOW()
       WHERE user_id = $1 AND revoked = FALSE`,
      [id]
    );
    return { ...rows[0], revoked_sessions: rowCount || 0 };
  });
}

/**
 * Soft delete: marca estado_registro = 'X'.
 * También revoca todas las sesiones activas del usuario.
 */
async function softDelete(id) {
  return withTransaction(async (client) => {
    // Revocar sesiones activas
    await client.query(
      `UPDATE sch_system.tbl_sessions
       SET revoked = TRUE, revoked_at = NOW()
       WHERE user_id = $1 AND revoked = FALSE`,
      [id]
    );
    // Soft delete
    const { rows } = await client.query(
      `UPDATE sch_system.tbl_users
       SET estado_registro = 'X', estado = 'IN', updated_at = NOW()
       WHERE id = $1 AND estado_registro = 'O'
       RETURNING id, username`,
      [id]
    );
    return rows[0] || null;
  });
}

/**
 * Resetea la contraseña de un usuario (genera temporal).
 */
async function updatePasswordHash(id, passwordHash) {
  await query(
    `UPDATE sch_system.tbl_users
     SET password_hash = $2, force_pwd_change = TRUE, updated_at = NOW()
     WHERE id = $1 AND estado_registro = 'O'`,
    [id, passwordHash]
  );
}

/**
 * Desbloquea una cuenta bloqueada por intentos fallidos.
 */
async function unlockAccount(id) {
  await query(
    `UPDATE sch_system.tbl_users
     SET failed_attempts = 0, locked_until = NULL, updated_at = NOW()
     WHERE id = $1`,
    [id]
  );
}

module.exports = {
  findAll,
  findById,
  existsByUsernameOrEmail,
  findAllRoles,
  findAllTeams,
  create,
  update,
  countActiveLocalAdmins,
  setEstado,
  softDelete,
  updatePasswordHash,
  unlockAccount,
};
