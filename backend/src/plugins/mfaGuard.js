'use strict';

const mfaService = require('../services/mfa.service');

// =============================================================================
// plugins/mfaGuard.js — Activación obligatoria del segundo factor.
//
// Si la política (ajuste mfa_policy) obliga al usuario y todavía no tiene el
// segundo factor activado, su sesión solo puede hacer lo imprescindible para
// activarlo: saber quién es, ver su perfil, activar el segundo factor, cambiar
// la contraseña (por si también se le exige) y cerrar sesión. Todo lo demás
// responde 403 MFA_ENROLLMENT_REQUIRED, que el frontend usa para llevarle al
// perfil. Mismo patrón que passwordChangeGuard, que se ejecuta antes.
//
// La política se lee en cada petición (con la caché de 30 s de settings.js):
// cambiarla en el panel se aplica a las sesiones abiertas, no solo a los
// próximos logins.
// =============================================================================

const ALLOWED = [
  'GET /api/auth/me',
  'POST /api/auth/logout',
  'GET /api/profile',
  'GET /api/profile/sessions',
  'POST /api/profile/change-password',
  'GET /api/profile/mfa',
  'POST /api/profile/mfa/setup',
  'POST /api/profile/mfa/enable',
];

const plugin = {
  name: 'icm-mfa-guard',
  register(server) {
    server.ext('onPostAuth', async (request, h) => {
      // Solo sesiones de usuario: el wizard usa su propia estrategia y sus
      // credenciales no tienen rol ni segundo factor.
      if (request.auth.strategy !== 'session') return h.continue;
      const user = request.auth.credentials;
      if (!user || user.mfaEnabled === true) return h.continue;
      if (ALLOWED.includes(`${request.method.toUpperCase()} ${request.path}`)) return h.continue;
      if (!(await mfaService.isRequired(user.level))) return h.continue;

      return h.response({
        success: false,
        code: 'MFA_ENROLLMENT_REQUIRED',
        message: 'Debes activar el segundo factor de autenticación antes de continuar.',
      }).code(403).takeover();
    });
  },
};

module.exports = plugin;
module.exports.ALLOWED = ALLOWED;
