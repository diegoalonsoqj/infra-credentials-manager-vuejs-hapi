'use strict';

const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const crypto    = require('crypto');
const repo      = require('../repositories/auth.repository');
const { query, withTransaction } = require('../config/database');
const { AUDIT_ACTIONS, RESULT, ROLE_LEVELS } = require('../config/constants');
const settings  = require('../config/settings');
const logger    = require('../utils/logger');
const mfaService = require('./mfa.service');
const { verifyPassword, DUMMY_BCRYPT_HASH } = require('./passwordVerifier');

// =============================================================================
// auth.service.js — Lógica de negocio de autenticación.
//
// FLUJO DE LOGIN:
//   1. Buscar usuario activo por username.
//   2. Comparar contraseña con bcrypt (SIEMPRE, incluso si la cuenta está
//      bloqueada: ver más abajo).
//   3. Si falla: incrementar contador, registrar LOGIN_FAIL en auditoría.
//   4. Verificar bloqueo temporal — solo DESPUÉS de validar la contraseña.
//   5. Si OK: resetear contador, manejar límite de sesiones, crear sesión,
//      generar JWT, registrar LOGIN_SUCCESS en auditoría.
//
// POR QUÉ EL BLOQUEO SE COMPRUEBA DESPUÉS DE LA CONTRASEÑA:
//   El mensaje "cuenta bloqueada" revela que el usuario existe. Comprobándolo
//   antes, cualquiera podía confirmar un nombre de usuario lanzando 5 intentos
//   y mirando si el mensaje cambiaba. Ahora ese mensaje solo lo ve quien ya
//   conoce la contraseña: para el resto todas las respuestas son idénticas.
//   Efecto secundario deseable: bcrypt se ejecuta en todos los caminos, así que
//   tampoco queda un oráculo por diferencia de tiempo.
//   Coste asumido: un intento contra una cuenta bloqueada ya no sale antes de
//   ejecutar bcrypt. El freno sigue siendo el rate limit de /api/auth.
//
// SEGURIDAD:
//   - El mensaje de error es siempre genérico (no revelar si el usuario existe).
//   - token_hash = SHA-256 del JWT (nunca el token en BD).
//   - Límite de sesiones concurrentes: revocar la más antigua si se supera.
// =============================================================================

// Bloqueo de cuenta por intentos fallidos. Ajustable desde el panel
// (account_lockout_attempts / account_lockout_minutes, migración 015); estos son
// los valores por defecto si la tabla no responde, y los rangos, los mismos que
// valida el PUT: fuera de ellos manda el default.
const LOCKOUT_ATTEMPTS_DEFAULT = 5;
const LOCKOUT_MINUTES_DEFAULT  = 15;
const LOCKOUT_ATTEMPTS_RANGE   = { min: 3, max: 20 };
const LOCKOUT_MINUTES_RANGE    = { min: 1, max: 1440 };
const GENERIC_AUTH_ERROR   = 'Usuario o contraseña incorrectos.';
// Token intermedio entre la contraseña y el código del segundo factor.
const MFA_TOKEN_PURPOSE    = 'mfa';
const MFA_TOKEN_TTL        = '5m';
const MFA_TOKEN_TTL_MS     = 5 * 60 * 1000;

// Tokens intermedios ya canjeados. Sin esto, el mismo token valdría para abrir
// varias sesiones durante sus 5 minutos (haría falta además un código válido,
// pero no hay razón para permitirlo). Se guardan en memoria: caducan solos, y si
// el proceso se reinicia el token pierde validez de todas formas.
const mfaTokensUsados = new Map(); // jti -> instante de caducidad

function consumirMfaToken(jti, exp) {
  const ahora = Date.now();
  for (const [id, vence] of mfaTokensUsados) {
    if (vence <= ahora) mfaTokensUsados.delete(id);
  }
  if (!jti) return true;                       // token antiguo sin jti: se deja pasar
  if (mfaTokensUsados.has(jti)) return false;  // ya canjeado
  mfaTokensUsados.set(jti, exp ? exp * 1000 : ahora + MFA_TOKEN_TTL_MS);
  return true;
}

// Rango aceptable de session_ttl_minutes: de 1 minuto a 30 días. Fuera de ahí se
// ignora el ajuste y manda JWT_EXPIRES_IN — un 0 mal tecleado en el panel no
// debe traducirse en sesiones que caducan al instante.
const SESSION_TTL_RANGE = { min: 1, max: 43200 };

/**
 * Registra una acción en el log de auditoría.
 * Asíncrono y no bloquea el flujo principal.
 */
async function audit({ userId, username, action, result, failReason, ipAddress, userAgent, extra }) {
  try {
    await query(
      `INSERT INTO sch_audit.tbl_audit_log
         (user_id, username, action, resource_type, result, fail_reason,
          ip_address, user_agent, extra_data)
       VALUES ($1, $2, $3, 'SYS', $4, $5, $6, $7, $8)`,
      [
        userId   || null,
        username || null,
        action,
        result,
        failReason || null,
        ipAddress  || null,
        userAgent  || null,
        JSON.stringify(extra || {}),
      ]
    );
  } catch (err) {
    logger.error('Error registrando auditoría:', { code: err.code });
  }
}

/**
 * Intento fallido de login (contraseña o, con segundo factor, código): suma al
 * contador del bloqueo de cuenta y lo audita. Con la cuenta ya bloqueada no se
 * incrementa el contador: si no, un atacante podría mantenerla bloqueada
 * indefinidamente.
 */
async function registrarFallo(user, isLocked, { ipAddress, userAgent, action, reason }) {
  let attemptsAfter = user.failed_attempts || 0;
  let justLocked = false;
  const maxFailedAttempts = await settings.getInt('account_lockout_attempts', LOCKOUT_ATTEMPTS_DEFAULT, LOCKOUT_ATTEMPTS_RANGE);
  const lockMinutes       = await settings.getInt('account_lockout_minutes', LOCKOUT_MINUTES_DEFAULT, LOCKOUT_MINUTES_RANGE);
  if (!isLocked) {
    const state = await repo.incrementFailedAttempts(user.id, maxFailedAttempts, lockMinutes);
    attemptsAfter = state ? state.failed_attempts : attemptsAfter + 1;
    // Transicion a bloqueada: se entra aqui solo si NO estaba bloqueada antes,
    // asi que un locked_until futuro despues del UPDATE significa que el
    // bloqueo acaba de producirse en este intento.
    justLocked = Boolean(state && state.locked_until) && new Date(state.locked_until) > new Date();
  }

  await audit({
    userId:   user.id,
    username: user.username,
    action,
    result:   RESULT.FAIL,
    failReason: reason,
    ipAddress,
    userAgent,
    extra: { attempts: attemptsAfter, locked: isLocked },
  });

  // El bloqueo se registra como evento independiente para que sea visible en
  // el filtro por accion del visor de auditoria y buscable en los logs. Antes
  // solo quedaba el rastro de cinco LOGIN_FAIL, que nadie iba a mirar: un
  // ataque de fuerza bruta que bloqueaba varias cuentas no disparaba nada.
  // (Hallazgo A3; la notificacion por email queda pendiente de que exista SMTP.)
  if (justLocked) {
    await audit({
      userId:   user.id,
      username: user.username,
      action:   AUDIT_ACTIONS.ACCOUNT_LOCKED,
      result:   RESULT.FAIL,
      failReason: `Cuenta bloqueada ${lockMinutes} minutos tras ${maxFailedAttempts} intentos fallidos.`,
      ipAddress,
      userAgent,
      extra: { attempts: attemptsAfter, lockMinutes },
    });
    logger.warn('Cuenta bloqueada por intentos fallidos.', {
      username: user.username,
      ip:       ipAddress,
      attempts: attemptsAfter,
      minutes:  lockMinutes,
    });
  }
}

/**
 * Login: valida credenciales y retorna JWT + datos del usuario.
 *
 * @param {{ username, password, ipAddress, userAgent }} params
 * @returns {{ token, user, expiresAt }}
 */
async function login({ username, password, ipAddress, userAgent }) {
  // 1. Buscar usuario
  const user = await repo.findUserByUsername(username);

  if (!user) {
    // Usuario no existe: ejecutar una comparación bcrypt señuelo para igualar el
    // tiempo de respuesta con el de un usuario real (anti-enumeración por timing).
    await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
    // Mismo mensaje genérico para no revelar existencia
    await audit({
      username,
      action:    AUDIT_ACTIONS.LOGIN_FAIL,
      result:    RESULT.FAIL,
      failReason: 'Usuario no encontrado.',
      ipAddress,
      userAgent,
    });
    throw new AuthError(GENERIC_AUTH_ERROR);
  }

  // 2. Verificar si el usuario está activo
  if (user.estado !== 'AI') {
    // Igualar tiempo de respuesta (anti-enumeración por timing).
    await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
    await audit({
      userId:    user.id,
      username:  user.username,
      action:    AUDIT_ACTIONS.LOGIN_FAIL,
      result:    RESULT.FAIL,
      failReason: 'Usuario inactivo.',
      ipAddress,
      userAgent,
    });
    throw new AuthError(GENERIC_AUTH_ERROR);
  }

  // 3. Verificar contraseña (bcrypt o directorio, según auth_source). bcrypt se
  //    ejecuta siempre, también con la cuenta bloqueada, para que el bloqueo no
  //    se pueda deducir por tiempo.
  //
  //    Con la cuenta bloqueada NO se consulta el directorio: cada intento sería
  //    también un fallo en AD, y un atacante podría usar ICM para bloquear la
  //    cuenta de dominio del usuario. El coste es que un usuario LDAP bloqueado
  //    recibe el mensaje genérico aunque acierte, hasta que venza el bloqueo.
  const isLocked = Boolean(user.locked_until) && new Date(user.locked_until) > new Date();
  let check;
  try {
    check = await verifyPassword(user, password, { skipDirectory: isLocked });
  } catch (err) {
    if (!err.isDirectoryUnavailable) throw err;
    // No es culpa de quien teclea: no suma al bloqueo de cuenta.
    await audit({
      userId: user.id, username: user.username, action: AUDIT_ACTIONS.LOGIN_FAIL,
      result: RESULT.FAIL, failReason: 'Directorio LDAP no disponible.', ipAddress, userAgent,
    });
    throw new ServiceUnavailableError('No se pudo verificar la contraseña con el directorio. Inténtalo más tarde.');
  }

  if (!check.ok) {
    const reason = isLocked ? `${check.reason} (cuenta bloqueada)` : check.reason;
    if (check.countable) {
      await registrarFallo(user, isLocked, { ipAddress, userAgent, action: AUDIT_ACTIONS.LOGIN_FAIL, reason });
    } else {
      await audit({
        userId: user.id, username: user.username, action: AUDIT_ACTIONS.LOGIN_FAIL,
        result: RESULT.FAIL, failReason: reason, ipAddress, userAgent,
      });
    }

    // Mensaje genérico SIEMPRE, incluso en el intento que dispara el bloqueo:
    // decir "cuenta bloqueada" aquí confirmaría que el usuario existe. El
    // contador y el bloqueo ya quedan en BD y en la auditoría.
    throw new AuthError(GENERIC_AUTH_ERROR);
  }

  // 4. Contraseña correcta. Solo ahora se revela el bloqueo: quien llega hasta
  //    aquí ya conoce la contraseña, así que el mensaje no filtra nada nuevo.
  //    No se crea sesión ni se resetea el contador: el bloqueo sigue vigente.
  if (isLocked) {
    const minutesLeft = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
    await audit({
      userId:   user.id,
      username: user.username,
      action:   AUDIT_ACTIONS.LOGIN_FAIL,
      result:   RESULT.FAIL,
      failReason: 'Cuenta bloqueada temporalmente.',
      ipAddress,
      userAgent,
    });
    throw new AuthError(
      `Cuenta bloqueada por demasiados intentos fallidos. Intenta nuevamente en ${minutesLeft} minuto(s).`
    );
  }

  // 4-bis. Acceso de visitantes desactivado desde el panel.
  //
  // Se comprueba DESPUES de validar la contraseña, por el mismo motivo que el
  // bloqueo: hacerlo antes daría un mensaje distinto a quien acierta el nombre
  // de un usuario VISITOR, y eso es un oráculo de enumeración. Quien llega aquí
  // ya conoce la contraseña. El contador de intentos no se resetea: no es un
  // login válido.
  if (user.role_level <= ROLE_LEVELS.VISITOR) {
    const visitorsAllowed = await settings.getBool('allow_visitor_access', true);
    if (!visitorsAllowed) {
      await audit({
        userId:   user.id,
        username: user.username,
        action:   AUDIT_ACTIONS.LOGIN_FAIL,
        result:   RESULT.FAIL,
        failReason: 'Acceso de visitantes desactivado.',
        ipAddress,
        userAgent,
      });
      throw new AuthError('El acceso de visitantes está desactivado. Contacta al administrador.');
    }
  }

  // 4-ter. Segundo factor. La contraseña es correcta, pero no se crea sesión ni
  //   se resetea el contador de intentos: se entrega un token de un solo
  //   propósito y 5 minutos que solo sirve para enviar el código (loginMfa).
  //   No es una cookie ni está en tbl_sessions, así que como credencial de
  //   sesión la rechaza plugins/auth.js.
  if (user.mfa_enabled) {
    const mfaToken = jwt.sign({ sub: user.id, purpose: MFA_TOKEN_PURPOSE }, process.env.JWT_SECRET,
      { expiresIn: MFA_TOKEN_TTL, jwtid: crypto.randomUUID() });
    return { mfaRequired: true, mfaToken };
  }

  return completarLogin(user, { ipAddress, userAgent });
}

/**
 * Segundo paso del login: código TOTP de la aplicación (Aegis…) o código de
 * recuperación, con el token que devolvió login(). Un código incorrecto cuenta
 * como intento fallido para el bloqueo de cuenta, igual que una contraseña.
 */
async function loginMfa({ mfaToken, code, ipAddress, userAgent }) {
  let decoded;
  try {
    decoded = jwt.verify(String(mfaToken || ''), process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    decoded = null;
  }
  if (!decoded || decoded.purpose !== MFA_TOKEN_PURPOSE) {
    throw new AuthError('La verificación caducó. Vuelve a iniciar sesión.');
  }

  const user = await repo.findUserById(decoded.sub);
  if (!user || user.estado !== 'AI' || !user.mfa_enabled) {
    throw new AuthError('La verificación caducó. Vuelve a iniciar sesión.');
  }
  const isLocked = Boolean(user.locked_until) && new Date(user.locked_until) > new Date();
  if (isLocked) {
    const minutesLeft = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
    throw new AuthError(`Cuenta bloqueada por demasiados intentos fallidos. Intenta nuevamente en ${minutesLeft} minuto(s).`);
  }

  const result = await mfaService.verifyCode(user.id, code);
  if (!result.ok) {
    await registrarFallo(user, false, {
      ipAddress, userAgent, action: AUDIT_ACTIONS.MFA_FAIL, reason: 'Código de segundo factor incorrecto.',
    });
    throw new AuthError('El código no es correcto.');
  }
  // El token se canjea aquí, no antes: un código incorrecto no debe gastarlo
  // (el usuario tiene que poder reintentar), pero un login correcto sí lo agota.
  if (!consumirMfaToken(decoded.jti, decoded.exp)) {
    throw new AuthError('La verificación caducó. Vuelve a iniciar sesión.');
  }
  if (result.method === 'recovery') {
    await audit({
      userId: user.id, username: user.username, action: AUDIT_ACTIONS.MFA_RECOVERY_USED,
      result: RESULT.SUCCESS, ipAddress, userAgent,
    });
  }
  return completarLogin(user, { ipAddress, userAgent, extra: { mfa: result.method } });
}

/** Última fase del login, común a los dos caminos: sesión, auditoría y respuesta. */
async function completarLogin(user, { ipAddress, userAgent, extra }) {
  // 5. Login exitoso — resetear contador de intentos
  await repo.resetFailedAttempts(user.id);

  // 6. Generar JWT (fuera de la transacción: no tiene efectos en BD)
  //
  // La duración sale de session_ttl_minutes (panel de administración). Antes el
  // ajuste existía en la tabla y no lo leía nadie: quien lo bajaba a 15 minutos
  // para endurecer el sistema seguía teniendo sesiones de 8 horas. JWT_EXPIRES_IN
  // queda como valor de arranque para cuando el ajuste falta o no es utilizable.
  const ttlMinutes = await settings.getInt('session_ttl_minutes', null, SESSION_TTL_RANGE);
  const expiresIn  = ttlMinutes ? `${ttlMinutes}m` : (process.env.JWT_EXPIRES_IN || '8h');
  const payload = {
    sub:      user.id,
    username: user.username,
    role:     user.role,
    team:     user.team || null,
    level:    user.role_level,
  };
  // jwtid aleatorio: sin él, dos logins del mismo usuario en el mismo segundo
  // (doble clic, dos pestañas) firmaban el MISMO token —iat tiene resolución de
  // segundos—, su token_hash chocaba con el UNIQUE de tbl_sessions y el segundo
  // respondía 409 tras haber pasado bcrypt.
  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn, jwtid: crypto.randomUUID() });

  // Obtener la fecha de expiración directamente del token ya firmado.
  // jwt.sign() ya parseó expiresIn correctamente (cualquier formato: 8h, 1d, 30m, etc.)
  const decoded = jwt.decode(token);
  const expiresAt = decoded?.exp
    ? new Date(decoded.exp * 1000)
    : new Date(Date.now() + 8 * 60 * 60 * 1000);

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const maxConcurrent = await settings.getInt(
    'session_max_concurrent',
    parseInt(process.env.SESSION_MAX_CONCURRENT || '3', 10),
    { min: 1, max: 100 }
  );

  // 7. Transacción atómica: crear la sesión respetando session_max_concurrent
  //    (ver crearSesionAcotada).
  const revocadas = await withTransaction((client) => crearSesionAcotada(client, {
    userId: user.id, tokenHash, ipAddress, userAgent, expiresAt, maxConcurrent,
  }));

  if (revocadas > 0) {
    logger.info('Sesiones antiguas revocadas por límite de sesiones concurrentes.', {
      username: user.username,
      revocadas,
    });
  }

  // 9. Auditoría de login exitoso
  await audit({
    userId:   user.id,
    username: user.username,
    action:   AUDIT_ACTIONS.LOGIN_SUCCESS,
    result:   RESULT.SUCCESS,
    ipAddress,
    userAgent,
    extra,
  });

  // 10. Cargar permisos del rol para incluirlos en la respuesta (frontend los guarda en sessionStorage)
  const { rows: permRows } = await query(
    `SELECT p.code
     FROM sch_system.tbl_role_permissions rp
     JOIN sch_system.tbl_permissions p ON p.id = rp.permission_id
     WHERE rp.role_id = (SELECT id FROM sch_system.tbl_roles WHERE code = $1 AND estado_registro = 'O')
     ORDER BY p.code`,
    [user.role]
  );
  const permissions = permRows.map((r) => r.code);

  logger.info('Login exitoso.', { username: user.username, ip: ipAddress });

  return {
    token,
    expiresAt,
    user: {
      id:                user.id,
      username:          user.username,
      firstName:         user.first_name || '',
      lastName:          user.last_name  || '',
      fullName:          user.full_name,
      email:             user.email,
      role:              user.role,
      roleLevel:         user.role_level,
      team:              user.team || null,
      teamResourceTypes: user.team_resource_types || [],
      forcePwdChange:    user.force_pwd_change,
      mfaEnabled:        user.mfa_enabled === true,
      authSource:        user.auth_source || 'LOCAL',
      permissions,
    },
  };
}

/**
 * Logout: revoca la sesión activa del token actual.
 *
 * @param {{ tokenHash, userId, username, ipAddress, userAgent }} params
 */
async function logout({ tokenHash, userId, username, ipAddress, userAgent }) {
  const revoked = await repo.revokeSessionByTokenHash(tokenHash);

  await audit({
    userId,
    username,
    action:   AUDIT_ACTIONS.LOGOUT,
    result:   RESULT.SUCCESS,
    ipAddress,
    userAgent,
    // Se deja constancia de si habia realmente una sesion que revocar: un
    // logout sobre una sesion ya cerrada o expirada no es lo mismo que uno
    // efectivo, y antes el resultado se descartaba sin mas.
    extra: { revoked },
  });

  logger.info('Logout.', { username });
  return { success: true };
}

/**
 * Clase de error de autenticación (para distinguir de errores internos).
 */
class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthError';
    this.isAuthError = true;
  }
}

/** El directorio LDAP no respondió: 503, no cuenta como intento fallido. */
class ServiceUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ServiceUnavailableError';
    this.isServiceUnavailable = true;
  }
}

/**
 * Crea la sesión del login respetando session_max_concurrent. Corre dentro de
 * la transacción del login.
 *
 * 1. Bloquea la fila del usuario. Así los logins simultáneos de una misma
 *    cuenta van uno detrás de otro. Antes se bloqueaban sus sesiones con
 *    FOR UPDATE, pero con cero sesiones abiertas no había fila que bloquear:
 *    varios logins a la vez veían "0" y todos creaban la suya.
 * 2. Revoca las más antiguas que sobren para dejar hueco a la nueva. Antes solo
 *    revocaba una: si el panel bajaba el límite de 5 a 2, un usuario con 5
 *    sesiones seguía con 5 tras volver a entrar.
 * 3. Crea la sesión.
 *
 * @param {object} client - Cliente dentro de la transacción.
 * @returns {Promise<number>} Sesiones revocadas.
 */
async function crearSesionAcotada(client, { userId, tokenHash, ipAddress, userAgent, expiresAt, maxConcurrent }) {
  await client.query(
    `SELECT id FROM sch_system.tbl_users WHERE id = $1 FOR UPDATE`,
    [userId]
  );

  const { rows } = await client.query(
    `SELECT id FROM sch_system.tbl_sessions
     WHERE user_id = $1 AND revoked = FALSE AND expires_at > NOW()
     ORDER BY created_at ASC`,
    [userId]
  );

  const sobrantes = rows.slice(0, Math.max(0, rows.length - maxConcurrent + 1)).map((r) => r.id);
  if (sobrantes.length > 0) {
    await client.query(
      `UPDATE sch_system.tbl_sessions
       SET revoked = TRUE, revoked_at = NOW()
       WHERE id = ANY($1)`,
      [sobrantes]
    );
  }

  await client.query(
    `INSERT INTO sch_system.tbl_sessions
       (user_id, token_hash, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, tokenHash, ipAddress, userAgent, expiresAt]
  );

  return sobrantes.length;
}

module.exports = { login, loginMfa, logout, AuthError, ServiceUnavailableError, crearSesionAcotada };
