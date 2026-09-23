'use strict';

const crypto = require('crypto');
const { Joi, M } = require('../validation');
const { login, loginMfa, logout } = require('../services/auth.service');
const { getActiveSessions } = require('../repositories/auth.repository');
const { query } = require('../config/database');
const { clientIp } = require('../utils/clientIp');
const { COOKIE_NAME } = require('../plugins/auth');

// =============================================================================
// auth.controller.js — Handlers HTTP de autenticación.
// =============================================================================

const loginSchema = Joi.object({
  username: Joi.string().trim().required().messages(M('El usuario es requerido.')),
  password: Joi.string().required().messages(M('La contraseña es requerida.')),
});

// Segundo paso: el token que devolvió el login y el código (TOTP de 6 dígitos
// o de recuperación, XXXXX-XXXXX).
const loginMfaSchema = Joi.object({
  mfaToken: Joi.string().max(2000).required().messages(M('Falta el token de verificación.')),
  code: Joi.string().trim().min(6).max(20).required().messages(M('El código es requerido.')),
});

// Cookie de sesión con la misma ventana que el JWT (ver handleLogin).
function setSessionCookie(h, result) {
  h.state(COOKIE_NAME, result.token, { ttl: result.expiresAt.getTime() - Date.now() });
  return { success: true, expiresAt: result.expiresAt, user: result.user };
}

/**
 * POST /api/auth/mfa — segundo paso del login con segundo factor.
 */
async function handleLoginMfa(request, h) {
  try {
    const result = await loginMfa({
      mfaToken:  request.payload.mfaToken,
      code:      request.payload.code,
      ipAddress: clientIp(request),
      userAgent: request.headers['user-agent'] || '',
    });
    return setSessionCookie(h, result);
  } catch (err) {
    if (err.isAuthError) {
      return h.response({ success: false, code: 'UNAUTHORIZED', message: err.message }).code(401);
    }
    if (err.isKeyUnavailable) {
      return h.response({ success: false, code: 'MASTER_KEY_ROTATING', message: err.message }).code(503);
    }
    throw err;
  }
}

/**
 * POST /api/auth/login
 */
async function handleLogin(request, h) {
  try {
    const { username, password } = request.payload;
    const ipAddress = clientIp(request);
    const userAgent = request.headers['user-agent'] || '';

    const result = await login({ username, password, ipAddress, userAgent });

    // Con segundo factor, la contraseña correcta no abre sesión: el cliente
    // pide el código y lo envía a /api/auth/mfa con este token.
    if (result.mfaRequired) {
      return { success: true, mfaRequired: true, mfaToken: result.mfaToken };
    }

    // Establecer cookie HttpOnly — el token nunca se expone a JavaScript del cliente.
    // El ttl se calcula desde result.expiresAt (ya sincronizado con JWT_EXPIRES_IN en el
    // servicio), así cookie y JWT siempre tienen exactamente la misma ventana de expiración.
    const cookieMaxAge = result.expiresAt.getTime() - Date.now();
    h.state(COOKIE_NAME, result.token, { ttl: cookieMaxAge });

    return {
      success:   true,
      expiresAt: result.expiresAt,
      user:      result.user,
    };
  } catch (err) {
    if (err.isAuthError) {
      return h.response({
        success: false,
        code:    'UNAUTHORIZED',
        message: err.message,
      }).code(401);
    }
    if (err.isServiceUnavailable) {
      return h.response({ success: false, code: 'DIRECTORY_UNAVAILABLE', message: err.message }).code(503);
    }
    throw err;
  }
}

/**
 * POST /api/auth/logout
 * Requiere autenticación (el esquema de sesión ya cargó las credenciales).
 */
async function handleLogout(request, h) {
  const user = request.auth.credentials;

  // Obtener token exclusivamente desde la cookie HttpOnly.
  // La autenticación ya validó que existe una sesión activa (cookie o header).
  // Usamos sessionId como respaldo si la cookie fue limpiada antes del logout.
  const token = request.state[COOKIE_NAME];

  if (!token) {
    // Cookie ya no está (ej: borrada por el navegador antes del logout).
    // Revocamos por sessionId directamente para garantizar que la sesión quede cerrada.
    await query(
      `UPDATE sch_system.tbl_sessions SET revoked = TRUE, revoked_at = NOW() WHERE id = $1`,
      [user.sessionId]
    );
    h.unstate(COOKIE_NAME);
    return { success: true, message: 'Sesión cerrada correctamente.' };
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  await logout({
    tokenHash,
    userId:    user.id,
    username:  user.username,
    ipAddress: clientIp(request),
    userAgent: request.headers['user-agent'] || '',
  });

  // Limpiar la cookie de sesión (hapi reutiliza las opciones de server.state,
  // que son las mismas con las que se estableció en el login).
  h.unstate(COOKIE_NAME);

  return { success: true, message: 'Sesión cerrada correctamente.' };
}

/**
 * GET /api/auth/me
 * Retorna los datos del usuario autenticado.
 */
function handleMe(request) {
  return {
    success: true,
    user: request.auth.credentials,
  };
}

/**
 * GET /api/auth/sessions
 * Retorna las sesiones activas del usuario autenticado.
 */
async function handleSessions(request) {
  const sessions = await getActiveSessions(request.auth.credentials.id);
  return { success: true, sessions };
}

module.exports = {
  loginSchema,
  loginMfaSchema,
  handleLogin,
  handleLoginMfa,
  handleLogout,
  handleMe,
  handleSessions,
};
