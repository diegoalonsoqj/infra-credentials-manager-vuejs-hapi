'use strict';

const { query } = require('../config/database');

// =============================================================================
// auth.repository.js — Queries de base de datos para autenticación.
// Todas las queries son parametrizadas. Nunca interpolación de strings.
// =============================================================================

// Usuario para el login, con rol y equipo. `campo` es una constante de este
// módulo ('username' o 'id'), nunca entrada del request.
function loginUserSql(campo) {
  return `SELECT
       u.id,
       u.username,
       u.email,
       u.full_name,
       u.first_name,
       u.last_name,
       u.password_hash,
       u.auth_source,
       u.force_pwd_change,
       u.failed_attempts,
       u.locked_until,
       u.estado,
       u.estado_registro,
       u.mfa_enabled,
       r.code  AS role,
       r.level AS role_level,
       t.code  AS team,
       COALESCE(
         ARRAY_AGG(trt.resource_type ORDER BY trt.resource_type) FILTER (WHERE trt.resource_type IS NOT NULL),
         ARRAY[]::varchar[]
       ) AS team_resource_types
     FROM sch_system.tbl_users u
     JOIN sch_system.tbl_roles r ON r.id = u.role_id
     LEFT JOIN sch_system.tbl_teams                t   ON t.id = u.team_id
     LEFT JOIN sch_system.tbl_team_resource_types  trt ON trt.team_id = t.id
     WHERE u.${campo} = $1
       AND u.estado_registro = 'O'
     GROUP BY u.id, r.code, r.level, t.code`;
}

/**
 * Busca un usuario activo por username para login.
 * Incluye role y team para construir req.user.
 */
async function findUserByUsername(username) {
  const { rows } = await query(loginUserSql('username'), [username]);
  return rows[0] || null;
}

/** Igual que findUserByUsername, por id: segundo paso del login (el token MFA lleva el id). */
async function findUserById(id) {
  const { rows } = await query(loginUserSql('id'), [id]);
  return rows[0] || null;
}

/**
 * Incrementa el contador de intentos fallidos.
 * Si supera el límite, bloquea la cuenta por lockDurationMinutes.
 */
async function incrementFailedAttempts(userId, maxAttempts = 5, lockDurationMinutes = 15) {
  // Devuelve el estado resultante: el bloqueo lo decide esta misma UPDATE, y
  // quien llama necesita saber si acaba de producirse para registrarlo como
  // evento propio (ACCOUNT_LOCKED). Sin esto habia que deducirlo contando.
  //
  // El contador ARRANCA DE NUEVO cuando el bloqueo anterior ya vencio. Antes se
  // acumulaba indefinidamente y solo lo reseteaba un login correcto, de modo que
  // una cuenta ya bloqueada una vez volvia a bloquearse al PRIMER fallo tras
  // expirar: bastaba una peticion cada 15 minutos para mantener a un usuario
  // fuera del sistema de forma indefinida, muy por debajo del limite por IP.
  // Ahora cada ciclo concede otra vez los intentos completos.
  const { rows } = await query(
    `WITH intento AS (
       SELECT
         id,
         CASE
           WHEN locked_until IS NOT NULL AND locked_until <= NOW() THEN 1
           ELSE failed_attempts + 1
         END AS n
       FROM sch_system.tbl_users
       WHERE id = $1
     )
     UPDATE sch_system.tbl_users u
     SET
       failed_attempts = i.n,
       locked_until = CASE
         WHEN i.n >= $2            THEN NOW() + ($3 || ' minutes')::interval
         WHEN u.locked_until > NOW() THEN u.locked_until  -- respeta un bloqueo vigente
         ELSE NULL                                        -- limpia uno ya vencido
       END,
       updated_at = NOW()
     FROM intento i
     WHERE u.id = i.id
     RETURNING u.failed_attempts, u.locked_until`,
    [userId, maxAttempts, lockDurationMinutes]
  );
  return rows[0] || null;
}

/**
 * Resetea intentos fallidos y actualiza last_login_at en login exitoso.
 */
async function resetFailedAttempts(userId) {
  await query(
    `UPDATE sch_system.tbl_users
     SET
       failed_attempts = 0,
       locked_until    = NULL,
       last_login_at   = NOW(),
       updated_at      = NOW()
     WHERE id = $1`,
    [userId]
  );
}

/**
 * Crea una nueva sesión en tbl_sessions.
 * token_hash = SHA-256 del JWT. NUNCA el token en texto plano.
 */
async function createSession({ userId, tokenHash, ipAddress, userAgent, expiresAt }) {
  const { rows } = await query(
    `INSERT INTO sch_system.tbl_sessions
       (user_id, token_hash, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [userId, tokenHash, ipAddress, userAgent, expiresAt]
  );
  return rows[0];
}

/**
 * Cuenta las sesiones activas (no revocadas, no expiradas) de un usuario.
 */
async function countActiveSessions(userId) {
  const { rows } = await query(
    `SELECT COUNT(*) AS count
     FROM sch_system.tbl_sessions
     WHERE user_id = $1
       AND revoked = FALSE
       AND expires_at > NOW()`,
    [userId]
  );
  return parseInt(rows[0].count, 10);
}

/**
 * Revoca la sesión más antigua del usuario (para respetar el límite de sesiones).
 */
async function revokeOldestSession(userId) {
  await query(
    `UPDATE sch_system.tbl_sessions
     SET revoked = TRUE, revoked_at = NOW()
     WHERE id = (
       SELECT id FROM sch_system.tbl_sessions
       WHERE user_id = $1
         AND revoked = FALSE
         AND expires_at > NOW()
       ORDER BY created_at ASC
       LIMIT 1
     )`,
    [userId]
  );
}

/**
 * Revoca una sesión por su token_hash (logout).
 */
async function revokeSessionByTokenHash(tokenHash) {
  const { rowCount } = await query(
    `UPDATE sch_system.tbl_sessions
     SET revoked = TRUE, revoked_at = NOW()
     WHERE token_hash = $1
       AND revoked = FALSE`,
    [tokenHash]
  );
  return rowCount > 0;
}

/**
 * Obtiene todas las sesiones activas de un usuario.
 *
 * NO se selecciona token_hash: estas filas viajan tal cual al cliente en
 * GET /api/auth/sessions y GET /api/profile/sessions, y el hash del token de
 * sesión no tiene por qué salir del servidor. La sesión actual se distingue
 * por su id (is_current en profile.routes.js), no por el hash.
 */
async function getActiveSessions(userId) {
  const { rows } = await query(
    `SELECT id, ip_address, user_agent, created_at, expires_at
     FROM sch_system.tbl_sessions
     WHERE user_id = $1
       AND revoked = FALSE
       AND expires_at > NOW()
     ORDER BY created_at DESC`,
    [userId]
  );
  return rows;
}

module.exports = {
  findUserByUsername,
  findUserById,
  incrementFailedAttempts,
  resetFailedAttempts,
  createSession,
  countActiveSessions,
  revokeOldestSession,
  revokeSessionByTokenHash,
  getActiveSessions,
};
