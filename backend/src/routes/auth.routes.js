'use strict';

const ctrl = require('../controllers/auth.controller');
const { VALIDATION_OPTIONS, failAction } = require('../validation');
const { rateLimitPre, loginKey, mfaKey } = require('../plugins/rateLimit');
const rateLimits = require('../config/rateLimits');

// =============================================================================
// auth.routes.js — Autenticación. Prefijo /api/auth.
// =============================================================================

module.exports = {
  name: 'icm-routes-auth',
  register(server) {
    server.route([
      // POST /api/auth/login  — público
      {
        method: 'POST',
        path: '/login',
        options: {
          auth: false,
          // Intentos por usuario e IP; el tope por IP lo pone rateLimits.AUTH_IP.
          pre: [rateLimitPre({ ...rateLimits.AUTH, keyOf: loginKey })],
          validate: {
            payload: ctrl.loginSchema,
            options: VALIDATION_OPTIONS,
            failAction,
          },
        },
        handler: ctrl.handleLogin,
      },

      // POST /api/auth/mfa — segundo paso del login (código TOTP o de
      // recuperación). Público: se autentica con el token que devolvió el login.
      {
        method: 'POST',
        path: '/mfa',
        options: {
          auth: false,
          pre: [rateLimitPre({ ...rateLimits.AUTH, keyOf: mfaKey })],
          validate: {
            payload: ctrl.loginMfaSchema,
            options: VALIDATION_OPTIONS,
            failAction,
          },
        },
        handler: ctrl.handleLoginMfa,
      },

      // POST /api/auth/logout — requiere token válido
      {
        method: 'POST',
        path: '/logout',
        options: { auth: 'session' },
        handler: ctrl.handleLogout,
      },

      // GET  /api/auth/me     — datos del usuario autenticado
      {
        method: 'GET',
        path: '/me',
        options: { auth: 'session' },
        handler: ctrl.handleMe,
      },

      // GET  /api/auth/sessions — sesiones activas del usuario
      {
        method: 'GET',
        path: '/sessions',
        options: { auth: 'session' },
        handler: ctrl.handleSessions,
      },
    ]);
  },
};
