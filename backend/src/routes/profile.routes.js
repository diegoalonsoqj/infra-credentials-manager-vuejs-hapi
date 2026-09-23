'use strict';

const bcrypt = require('bcryptjs');
const { query, withTransaction } = require('../config/database');
const authRepo  = require('../repositories/auth.repository');
const { AUDIT_ACTIONS, RESULT } = require('../config/constants');
const { validatePasswordStrength, PASSWORD_MIN_LENGTH_FLOOR } = require('../utils/crypto');
const settings = require('../config/settings');
const { clientIp } = require('../utils/clientIp');
const { rateLimitPre, userKey } = require('../plugins/rateLimit');
const { PASSWORD_CHANGE, MFA_MANAGE } = require('../config/rateLimits');
const logger = require('../utils/logger');
const mfaService = require('../services/mfa.service');
const {
  Joi, M, VALIDATION_OPTIONS, failAction, uuidParam,
} = require('../validation');

// =============================================================================
// profile.routes.js — Perfil del usuario autenticado. Prefijo /api/profile.
//
// Endpoints:
//   GET    /api/profile                 — datos completos del perfil
//   POST   /api/profile/change-password — cambio de contraseña propio
//   GET    /api/profile/sessions        — sesiones activas propias
//   DELETE /api/profile/sessions/:id    — revocar sesión específica (no la actual)
//   DELETE /api/profile/sessions        — revocar todas excepto la actual
//   GET    /api/profile/mfa             — estado del segundo factor
//   POST   /api/profile/mfa/setup       — inicia la activación (secreto y QR)
//   POST   /api/profile/mfa/enable      — la confirma con el primer código
//   POST   /api/profile/mfa/disable     — la quita (contraseña + código)
//   POST   /api/profile/mfa/recovery-codes — nuevos códigos (contraseña + código)
// =============================================================================

/**
 * ID de la sesión actual (ya validado por la estrategia de autenticación).
 * Más robusto que calcular un hash desde el header/cookie: no depende del
 * origen del token.
 */
function currentSessionId(request) {
  return request.auth.credentials.sessionId;
}

async function auditAction({ actorId, actorUsername, action, result, failReason, ipAddress }) {
  try {
    await query(
      `INSERT INTO sch_audit.tbl_audit_log
         (user_id, username, action, resource_type, result, fail_reason, ip_address, extra_data)
       VALUES ($1,$2,$3,'SYS',$4,$5,$6,'{}')`,
      [actorId, actorUsername, action, result, failReason || null, ipAddress || null]
    );
  } catch (err) {
    logger.error('Error en auditoría de perfil:', { code: err.code });
  }
}

// ---------------------------------------------------------------------------
// Validación del cambio de contraseña
// ---------------------------------------------------------------------------
const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().min(1).required()
    .messages(M('La contraseña actual es requerida.')),

  // Sin comodín '*' en los mensajes: el validador de fortaleza devuelve su
  // propio texto y un comodín lo sobrescribiría.
  newPassword: Joi.string()
    .min(12)
    .invalid(Joi.ref('currentPassword'))
    .custom((value, helpers) => {
      const result = validatePasswordStrength(value);
      return result.valid ? value : helpers.message(result.message);
    })
    .required()
    .messages({
      'string.min':   'La nueva contraseña debe tener al menos 12 caracteres.',
      'any.invalid':  'La nueva contraseña no puede ser igual a la actual.',
      'any.required': 'La nueva contraseña es requerida.',
      'string.empty': 'La nueva contraseña es requerida.',
      'string.base':  'La nueva contraseña es requerida.',
    }),
});

const sessionIdParam = uuidParam('ID de sesión inválido.');

const validate = (parts) => ({ ...parts, options: VALIDATION_OPTIONS, failAction });

// bcrypt f14 dos veces por peticion (compare + hash): ~3,8 s de CPU en un hilo
// que es el mismo que atiende al resto de la API. Se cuenta por usuario.
const cambioPasswordLimiter = rateLimitPre({ ...PASSWORD_CHANGE, keyOf: userKey });

// Segundo factor. Activar, desactivar y regenerar prueban códigos (y los dos
// últimos, además, bcrypt): límite propio por usuario (RATE_LIMIT_MFA_MAX),
// más holgado que el del cambio de contraseña porque teclear mal el primer
// código al escanear el QR es normal.
const mfaLimiter = rateLimitPre({ ...MFA_MANAGE, keyOf: userKey });
const mfaCodeSchema = Joi.object({
  code: Joi.string().trim().pattern(/^\d{6}$/).required().messages(M('El código debe tener 6 dígitos.')),
});
const mfaReauthSchema = Joi.object({
  password: Joi.string().max(256).required().messages(M('La contraseña es requerida.')),
  code: Joi.string().trim().min(6).max(20).required().messages(M('El código es requerido.')),
});

// Errores del servicio de segundo factor → respuesta HTTP.
async function runMfa(h, fn) {
  try {
    return await fn();
  } catch (err) {
    if (err.isValidation) return h.response({ success: false, code: 'VALIDATION_ERROR', message: err.message }).code(400);
    if (err.isForbidden)  return h.response({ success: false, code: 'FORBIDDEN', message: err.message }).code(403);
    if (err.isKeyUnavailable) return h.response({ success: false, code: 'MASTER_KEY_ROTATING', message: err.message }).code(503);
    if (err.isDirectoryUnavailable) {
      return h.response({ success: false, code: 'DIRECTORY_UNAVAILABLE', message: 'No se pudo verificar la contraseña con el directorio. Inténtalo más tarde.' }).code(503);
    }
    throw err;
  }
}

const actorOf = (request) => ({ ...request.auth.credentials, ip: clientIp(request) });

module.exports = {
  name: 'icm-routes-profile',
  register(server) {
    server.route([
      // -----------------------------------------------------------------
      // GET /api/profile
      // -----------------------------------------------------------------
      {
        method: 'GET',
        path: '/',
        options: { auth: 'session' },
        handler: async (request, h) => {
          const { rows } = await query(
            `SELECT u.id, u.username, u.email, u.full_name, u.first_name, u.last_name,
                    u.force_pwd_change, u.last_login_at, u.created_at, u.auth_source,
                    r.code AS role, r.name AS role_name,
                    t.code AS team, t.name AS team_name
             FROM sch_system.tbl_users u
             JOIN sch_system.tbl_roles r ON r.id = u.role_id
             LEFT JOIN sch_system.tbl_teams t ON t.id = u.team_id
             WHERE u.id = $1 AND u.estado_registro = 'O'`,
            [request.auth.credentials.id]
          );
          if (!rows[0]) {
            return h.response({ success: false, message: 'Perfil no encontrado.' }).code(404);
          }
          return { success: true, profile: rows[0] };
        },
      },

      // -----------------------------------------------------------------
      // Segundo factor (TOTP)
      // -----------------------------------------------------------------
      {
        method: 'GET',
        path: '/mfa',
        options: { auth: 'session' },
        handler: (request, h) => runMfa(h, async () => ({ success: true, mfa: await mfaService.status(actorOf(request)) })),
      },
      {
        method: 'POST',
        path: '/mfa/setup',
        options: { auth: 'session', pre: [mfaLimiter] },
        handler: (request, h) => runMfa(h, async () => ({ success: true, ...(await mfaService.beginSetup(actorOf(request))) })),
      },
      {
        method: 'POST',
        path: '/mfa/enable',
        options: { auth: 'session', pre: [mfaLimiter], validate: validate({ payload: mfaCodeSchema }) },
        handler: (request, h) => runMfa(h, async () =>
          ({ success: true, ...(await mfaService.confirmSetup(actorOf(request), request.payload.code)) })),
      },
      {
        method: 'POST',
        path: '/mfa/disable',
        options: { auth: 'session', pre: [mfaLimiter], validate: validate({ payload: mfaReauthSchema }) },
        handler: (request, h) => runMfa(h, async () =>
          ({ success: true, ...(await mfaService.disable(actorOf(request), request.payload)) })),
      },
      {
        method: 'POST',
        path: '/mfa/recovery-codes',
        options: { auth: 'session', pre: [mfaLimiter], validate: validate({ payload: mfaReauthSchema }) },
        handler: (request, h) => runMfa(h, async () =>
          ({ success: true, ...(await mfaService.regenerateRecoveryCodes(actorOf(request), request.payload)) })),
      },

      // -----------------------------------------------------------------
      // POST /api/profile/change-password
      // -----------------------------------------------------------------
      {
        method: 'POST',
        path: '/change-password',
        options: {
          auth: 'session',
          pre: [cambioPasswordLimiter],
          validate: validate({ payload: changePasswordSchema }),
        },
        handler: async (request, h) => {
          const user = request.auth.credentials;
          const { currentPassword, newPassword } = request.payload;

          // La contraseña de un usuario LDAP es la del dominio: se cambia en AD.
          if (user.authSource === 'LDAP') {
            return h.response({
              success: false,
              code: 'LDAP_USER',
              message: 'Tu contraseña es la del dominio: cámbiala en el directorio (Active Directory), no aquí.',
            }).code(400);
          }

          // Obtener hash actual
          const { rows } = await query(
            `SELECT password_hash FROM sch_system.tbl_users WHERE id = $1 AND estado_registro = 'O'`,
            [user.id]
          );
          if (!rows[0]) {
            return h.response({ success: false, message: 'Usuario no encontrado.' }).code(404);
          }

          // Verificar contraseña actual
          const valid = await bcrypt.compare(currentPassword, rows[0].password_hash);
          if (!valid) {
            await auditAction({
              actorId: user.id, actorUsername: user.username,
              action: AUDIT_ACTIONS.USER_UPDATE,
              result: RESULT.FAIL, failReason: 'Contraseña actual incorrecta.',
              ipAddress: clientIp(request),
            });
            return h.response({
              success: false,
              code: 'INVALID_PASSWORD',
              message: 'La contraseña actual es incorrecta.',
            }).code(400);
          }

          // El esquema Joi ya aplicó el suelo de 12 caracteres y las reglas de
          // composición. Aquí solo se comprueba si el panel exige MÁS longitud
          // (password_min_length), que es lo único que el ajuste puede hacer.
          const minLength = await settings.getInt('password_min_length', PASSWORD_MIN_LENGTH_FLOOR, {
            min: PASSWORD_MIN_LENGTH_FLOOR,
            max: 128,
          });
          if (minLength > PASSWORD_MIN_LENGTH_FLOOR) {
            const strength = validatePasswordStrength(newPassword, minLength);
            if (!strength.valid) {
              return h.response({
                success: false,
                code: 'VALIDATION_ERROR',
                message: strength.message,
              }).code(400);
            }
          }

          // Hashear nueva contraseña
          const newHash = await bcrypt.hash(newPassword, 14);

          // El cambio de contraseña y la revocación van en la misma transacción:
          // dejar la contraseña nueva con las sesiones viejas todavía vivas es
          // justo el estado que este cambio pretende evitar.
          //
          // SEGURIDAD: quien cambia su contraseña en un gestor de credenciales
          // suele hacerlo porque sospecha que se la han robado. Sin esto, la
          // sesión del atacante seguía siendo válida hasta expires_at (8 h por
          // defecto) y conservaba CRED_REVEAL. El reseteo hecho por un ADMIN sí
          // quedaba contenido, porque deja force_pwd_change = TRUE y
          // passwordChangeGuard reduce esas sesiones a cinco rutas; este camino
          // era el único que se escapaba, y además pone la marca a FALSE.
          //
          // La sesión actual se conserva: el usuario acaba de demostrar que
          // conoce la contraseña anterior, y cerrarle la sesión por cambiarla
          // solo obligaría a volver a entrar.
          let revokedCount = 0;
          await withTransaction(async (client) => {
            await client.query(
              `UPDATE sch_system.tbl_users
               SET password_hash = $2, force_pwd_change = FALSE, updated_at = NOW()
               WHERE id = $1`,
              [user.id, newHash]
            );

            const revoked = await client.query(
              `UPDATE sch_system.tbl_sessions
               SET revoked = TRUE, revoked_at = NOW()
               WHERE user_id = $1
                 AND revoked = FALSE
                 AND expires_at > NOW()
                 AND id <> $2`,
              [user.id, currentSessionId(request)]
            );
            revokedCount = revoked.rowCount || 0;
          });

          await auditAction({
            actorId: user.id, actorUsername: user.username,
            action: AUDIT_ACTIONS.USER_UPDATE,
            result: RESULT.SUCCESS, ipAddress: clientIp(request),
          });

          logger.info('Contraseña cambiada por el usuario.', {
            username: user.username,
            revokedSessions: revokedCount,
          });
          return {
            success: true,
            message: revokedCount > 0
              ? `Contraseña actualizada correctamente. Se cerraron ${revokedCount} sesión(es) abiertas en otros dispositivos.`
              : 'Contraseña actualizada correctamente.',
            revokedSessions: revokedCount,
          };
        },
      },

      // -----------------------------------------------------------------
      // GET /api/profile/sessions
      // -----------------------------------------------------------------
      {
        method: 'GET',
        path: '/sessions',
        options: { auth: 'session' },
        handler: async (request) => {
          const sessions = await authRepo.getActiveSessions(request.auth.credentials.id);
          const sessId = currentSessionId(request);
          // Marcar la sesión actual para que el frontend la distinga
          const marked = sessions.map((s) => ({ ...s, is_current: s.id === sessId }));
          return { success: true, sessions: marked };
        },
      },

      // -----------------------------------------------------------------
      // DELETE /api/profile/sessions/:id — revocar sesión específica
      // -----------------------------------------------------------------
      {
        method: 'DELETE',
        path: '/sessions/{id}',
        options: {
          auth: 'session',
          validate: validate({ params: sessionIdParam }),
        },
        handler: async (request, h) => {
          const user = request.auth.credentials;

          // Verificar que la sesión pertenece al usuario y no es la sesión actual
          const { rows } = await query(
            `SELECT id FROM sch_system.tbl_sessions
             WHERE id = $1 AND user_id = $2 AND revoked = FALSE AND expires_at > NOW()`,
            [request.params.id, user.id]
          );
          if (!rows[0]) {
            return h.response({ success: false, message: 'Sesión no encontrada.' }).code(404);
          }
          if (rows[0].id === currentSessionId(request)) {
            return h.response({
              success: false,
              message: 'Usa el endpoint de logout para cerrar la sesión actual.',
            }).code(400);
          }

          await query(
            `UPDATE sch_system.tbl_sessions SET revoked = TRUE, revoked_at = NOW() WHERE id = $1`,
            [request.params.id]
          );

          await auditAction({
            actorId: user.id, actorUsername: user.username,
            action: AUDIT_ACTIONS.SESSION_REVOKED,
            result: RESULT.SUCCESS, ipAddress: clientIp(request),
          });

          return { success: true, message: 'Sesión revocada.' };
        },
      },

      // -----------------------------------------------------------------
      // DELETE /api/profile/sessions — revocar todas excepto la actual
      // -----------------------------------------------------------------
      {
        method: 'DELETE',
        path: '/sessions',
        options: { auth: 'session' },
        handler: async (request) => {
          const user = request.auth.credentials;

          const { rowCount } = await query(
            `UPDATE sch_system.tbl_sessions
             SET revoked = TRUE, revoked_at = NOW()
             WHERE user_id = $1
               AND id <> $2
               AND revoked = FALSE
               AND expires_at > NOW()`,
            [user.id, currentSessionId(request)]
          );

          await auditAction({
            actorId: user.id, actorUsername: user.username,
            action: AUDIT_ACTIONS.SESSION_REVOKED,
            result: RESULT.SUCCESS, ipAddress: clientIp(request),
          });

          return { success: true, message: `${rowCount} sesión(es) revocada(s).`, revoked: rowCount };
        },
      },
    ]);
  },
};
