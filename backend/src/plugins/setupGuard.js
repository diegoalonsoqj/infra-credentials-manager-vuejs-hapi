'use strict';

const { isSetupCompleted } = require('../setup/setupState');

// =============================================================================
// plugins/setupGuard.js — Bloqueo global mientras el sistema no esté instalado.
//
// Si el wizard no se ha completado, cualquier ruta /api/* devuelve
// 503 SETUP_REQUIRED. El frontend detecta ese código y redirige a /setup.
//
// Excepciones (siempre accesibles, como antes):
//   - /api/health : health check.
//   - /api/setup/*: el propio wizard de instalación.
//
// Se ejecuta en onPreAuth (después del enrutamiento, antes de autenticar) para
// que un sistema sin instalar responda 503 y no 401, igual que cuando el guard
// se registraba antes de las rutas de módulo en Express.
// =============================================================================

const ALWAYS_ALLOWED = ['/api/health'];
const ALLOWED_PREFIX = '/api/setup';

const plugin = {
  name: 'icm-setup-guard',
  register(server) {
    server.ext('onPreAuth', (request, h) => {
      const path = request.path;

      const isApi = path === '/api' || path.startsWith('/api/');
      if (!isApi) return h.continue;

      if (ALWAYS_ALLOWED.includes(path)) return h.continue;
      if (path === ALLOWED_PREFIX || path.startsWith(`${ALLOWED_PREFIX}/`)) return h.continue;

      if (!isSetupCompleted()) {
        return h.response({
          success: false,
          code: 'SETUP_REQUIRED',
          message: 'El sistema no ha sido configurado. Completa el wizard de instalación.',
        }).code(503).takeover();
      }

      return h.continue;
    });
  },
};

module.exports = plugin;
