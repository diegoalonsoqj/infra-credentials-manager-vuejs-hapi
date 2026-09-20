'use strict';

const ctrl = require('../controllers/setupController');
const { VALIDATION_OPTIONS, failAction } = require('../validation');

// =============================================================================
// setup.routes.js — Rutas del wizard de instalación. Prefijo /api/setup.
//
// /status : sin autenticación — siempre accesible para detección de estado.
// El resto usa la estrategia 'setup' (x-setup-token + bloqueo post-instalación).
//
// Los límites de peticiones de /test-db y /finalize se aplican por prefijo de
// ruta antes del enrutamiento (ver config/rateLimits.js).
// =============================================================================

module.exports = {
  name: 'icm-routes-setup',
  register(server) {
    server.route([
      // GET /api/setup/status — Estado de instalación (siempre accesible)
      {
        method: 'GET',
        path: '/status',
        options: { auth: false },
        handler: ctrl.getStatus,
      },

      // POST /api/setup/test-db — Probar conexión BD (Paso 0)
      {
        method: 'POST',
        path: '/test-db',
        options: {
          auth: 'setup',
          validate: {
            payload: ctrl.testDbSchema,
            options: VALIDATION_OPTIONS,
            failAction,
          },
        },
        handler: ctrl.testDatabase,
      },

      // GET /api/setup/generate-key — Generar Master Key segura (Paso 1)
      {
        method: 'GET',
        path: '/generate-key',
        options: { auth: 'setup' },
        handler: ctrl.suggestMasterKey,
      },

      // POST /api/setup/validate-key — Validar entropía de Master Key (Paso 1)
      {
        method: 'POST',
        path: '/validate-key',
        options: {
          auth: 'setup',
          validate: {
            payload: ctrl.masterKeySchema,
            options: VALIDATION_OPTIONS,
            failAction,
          },
        },
        handler: ctrl.validateMasterKey,
      },

      // POST /api/setup/finalize — Ejecutar instalación completa (Paso 3)
      {
        method: 'POST',
        path: '/finalize',
        options: {
          auth: 'setup',
          // La instalación ejecuta migraciones + bcrypt f14: puede tardar
          // bastante más que el resto de endpoints.
          timeout: { server: false },
          validate: {
            payload: ctrl.finalizeSchema,
            options: VALIDATION_OPTIONS,
            failAction,
          },
        },
        handler: ctrl.finalizeSetup,
      },
    ]);
  },
};
