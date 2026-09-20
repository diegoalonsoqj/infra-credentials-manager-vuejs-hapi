'use strict';

// dotenv debe cargarse ANTES que cualquier módulo que lea process.env al
// importarse (corsConfig, clientIp, securityHeaders, rateLimits…).
require('dotenv').config();

const path  = require('path');
const Hapi  = require('@hapi/hapi');
const Inert = require('@hapi/inert');

const rateLimits  = require('./config/rateLimits');
const { isSetupCompleted } = require('./setup/setupState');

// =============================================================================
// server.js — Construcción del servidor hapi.
//
// ORDEN DE REGISTRO (CRÍTICO — no reordenar):
//   1. Inert            — sirve archivos estáticos (frontend compilado).
//   2. Errores          — 404 y manejador global. Debe ir ANTES de los plugins
//                         que añaden cabeceras: reemplaza la respuesta y las
//                         cabeceras puestas antes se perderían.
//   3. CORS             — corta el preflight en onRequest, antes del rate limit.
//   4. Rate limiting    — límites por prefijo de ruta, antes del enrutamiento.
//   5. Cabeceras de seguridad
//   6. Log de peticiones
//   7. Normalización del payload vacío
//   8. Autenticación    — estrategias 'session' y 'setup'.
//   9. Guard de instalación — 503 SETUP_REQUIRED mientras no se complete el wizard.
//   9b. Guard de cambio de contraseña — 403 PASSWORD_CHANGE_REQUIRED mientras
//       force_pwd_change siga a TRUE.
//   9b-bis. Guard de segundo factor — 403 MFA_ENROLLMENT_REQUIRED si la política
//       lo exige y el usuario no lo ha activado.
//   9c. Entrada estricta — 400 si una ruta sin esquema recibe query o cuerpo.
//  10. Health check     — siempre disponible.
//  11. Rutas de módulos, cada una con su prefijo.
//  12. Frontend compilado (solo en producción).
//
// Lo que en Express eran middlewares de terceros lo cubre hapi de fábrica:
//   - express.json    → parseo de payload (maxBytes 1 MB, igual que antes).
//   - cookie-parser   → request.state.
//   - compression     → compresión gzip/deflate automática según Accept-Encoding.
// =============================================================================

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const FRONTEND_DIST = path.resolve(__dirname, '../../frontend/dist');
const SPA_INDEX     = path.join(FRONTEND_DIST, 'index.html');

const PORT = parseInt(process.env.APP_PORT || '8743', 10);
const HOST = process.env.APP_HOST || '0.0.0.0';

// Rutas de módulo y su prefijo (equivalente a los app.use('/api/x', router)).
const MODULE_ROUTES = [
  ['/api/auth',         require('./routes/auth.routes')],
  ['/api/catalogs',     require('./routes/catalogs.routes')],
  ['/api/credentials',  require('./routes/credentials.routes')],
  ['/api/resources',    require('./routes/resources.routes')],
  ['/api/applications', require('./routes/applications.routes')],
  ['/api/audit',        require('./routes/audit.routes')],
  ['/api/admin',        require('./routes/admin.routes')],
  ['/api/profile',      require('./routes/profile.routes')],
  ['/api/security',     require('./routes/security.routes')],
  ['/api/system',       require('./routes/system.routes')],
  ['/api/dashboard',    require('./routes/dashboard.routes')],
];

/**
 * Construye el servidor con todos los plugins y rutas registrados.
 * No lo arranca: los tests lo usan con server.inject().
 *
 * @returns {Promise<object>} Servidor hapi inicializado.
 */
async function createServer() {
  const server = Hapi.server({
    port: PORT,
    host: HOST,
    routes: {
      // CORS lo gestiona plugins/cors.js: el origen es mutable en caliente y
      // la configuración nativa de hapi se resuelve al arrancar.
      cors: false,
      // Cookies no declaradas no invalidan la petición (como cookie-parser).
      state: { parse: true, failAction: 'ignore' },
      payload: {
        // 1 MB, el mismo límite que express.json({ limit: '1mb' }).
        maxBytes: 1048576,
        // Hallazgo A4 de AUDITORIA_SEGURIDAD.md: toda la API consume JSON, así que
        // no se acepta ningún otro Content-Type. Cierra la vía de las "simple
        // requests" (application/x-www-form-urlencoded y text/plain), que un
        // formulario alojado en otro sitio puede enviar sin preflight CORS.
        allow: 'application/json',
        // Una petición sin Content-Type se sigue tratando como JSON, igual que antes.
        defaultContentType: 'application/json',
      },
      files: { relativeTo: FRONTEND_DIST },
    },
    router: {
      // Express ignoraba la barra final por defecto (strict routing desactivado).
      stripTrailingSlash: true,
      // Se mantiene el enrutado sensible a mayúsculas de hapi: los guards de
      // /api/* comparan la ruta como texto, y aceptar /API/… los eludiría.
      isCaseSensitive: true,
    },
  });

  await server.register(Inert);

  await server.register({
    plugin: require('./plugins/errors'),
    options: { spaIndexPath: IS_PRODUCTION ? SPA_INDEX : null },
  });

  await server.register(require('./plugins/cors'));

  await server.register({
    plugin: require('./plugins/rateLimit'),
    options: { byPathPrefix: rateLimits.BY_PATH_PREFIX, byUser: rateLimits.BY_USER },
  });

  await server.register(require('./plugins/securityHeaders'));
  await server.register(require('./plugins/requestLogger'));
  await server.register(require('./plugins/payload'));
  await server.register(require('./plugins/auth'));
  await server.register(require('./plugins/setupGuard'));
  await server.register(require('./plugins/passwordChangeGuard'));
  await server.register(require('./plugins/mfaGuard'));
  // Rutas sin esquema de query o de cuerpo: cualquier entrada que les llegue se
  // rechaza. Complementa allowUnknown: false de validation/index.js.
  await server.register(require('./plugins/strictInput'));

  // ---------------------------------------------------------------------------
  // Health check — siempre disponible (exento del guard de instalación)
  // ---------------------------------------------------------------------------
  server.route({
    method: 'GET',
    path: '/api/health',
    options: { auth: false },
    handler: () => ({
      status:    'ok',
      installed: isSetupCompleted(),
      version:   process.env.APP_VERSION || '1.0.0',
      timestamp: new Date().toISOString(),
    }),
  });

  // ---------------------------------------------------------------------------
  // Rutas del wizard — SIEMPRE disponibles, incluso antes de la instalación
  // (el guard de instalación las exime explícitamente).
  // ---------------------------------------------------------------------------
  await server.register(require('./routes/setup.routes'), { routes: { prefix: '/api/setup' } });

  // ---------------------------------------------------------------------------
  // Rutas de módulos
  // ---------------------------------------------------------------------------
  for (const [prefix, plugin] of MODULE_ROUTES) {
    await server.register(plugin, { routes: { prefix } });
  }

  // ---------------------------------------------------------------------------
  // Servir el frontend compilado (solo en producción).
  // En desarrollo, Vite corre en su propio servidor (puerto 5173).
  // Las rutas del SPA que no existen como archivo caen en el 404 y el plugin de
  // errores devuelve index.html para que el router de Vue tome el control.
  // ---------------------------------------------------------------------------
  if (IS_PRODUCTION) {
    server.route({
      method: 'GET',
      path: '/{param*}',
      options: { auth: false },
      handler: {
        directory: { path: '.', index: true, redirectToSlash: false },
      },
    });
  }

  await server.initialize();
  return server;
}

/**
 * Construye y arranca el servidor.
 *
 * @returns {Promise<object>} Servidor hapi en ejecución.
 */
async function start() {
  const server = await createServer();
  await server.start();
  return server;
}

module.exports = { createServer, start, PORT, HOST };
