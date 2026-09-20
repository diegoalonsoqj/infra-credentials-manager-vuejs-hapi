'use strict';

const corsConfig = require('../config/corsConfig');

// =============================================================================
// plugins/cors.js — CORS con origen mutable en tiempo de ejecución.
//
// hapi trae CORS integrado (route.options.cors), pero resuelve la configuración
// al arrancar el servidor: no serviría aquí, porque el panel de administración
// cambia corsConfig.origin en caliente (PUT /api/system/settings/cors_origin).
// Por eso se implementa como extensiones del ciclo de vida, leyendo
// corsConfig.origin en cada request.
//
// El comportamiento replica exactamente el del middleware `cors` que se usaba:
//   - Preflight (OPTIONS con Access-Control-Request-Method): 204 con
//     Allow-Origin / Allow-Credentials / Allow-Methods / Allow-Headers y
//     Content-Length: 0. Corta el ciclo (no llega al enrutador).
//   - Resto de requests: solo Allow-Origin, Allow-Credentials y Vary: Origin.
//
// El preflight se corta en onRequest —igual que en Express, donde `cors` se
// registraba antes del rate limiter— para que no consuma cuota de rate limit.
// =============================================================================

const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const ALLOWED_HEADERS = ['Content-Type', 'Authorization', 'x-setup-token'];

/**
 * Escribe una cabecera tanto en respuestas normales como en errores Boom.
 */
function setHeader(response, name, value) {
  if (response.isBoom) {
    response.output.headers[name] = value;
  } else {
    response.header(name, value);
  }
}

const plugin = {
  name: 'icm-cors',
  register(server) {
    // Preflight: se resuelve antes del enrutamiento y no consume rate limit.
    server.ext('onRequest', (request, h) => {
      if (request.method !== 'options') return h.continue;
      if (!request.headers.origin) return h.continue;
      if (!request.headers['access-control-request-method']) return h.continue;

      return h
        .response()
        .code(204)
        .header('Access-Control-Allow-Origin', corsConfig.origin)
        .header('Vary', 'Origin')
        .header('Access-Control-Allow-Credentials', 'true')
        .header('Access-Control-Allow-Methods', ALLOWED_METHODS.join(','))
        .header('Access-Control-Allow-Headers', ALLOWED_HEADERS.join(','))
        .header('Content-Length', '0')
        .takeover();
    });

    // Requests reales: solo origen y credenciales (igual que el paquete `cors`).
    server.ext('onPreResponse', (request, h) => {
      const response = request.response;
      setHeader(response, 'Access-Control-Allow-Origin', corsConfig.origin);
      setHeader(response, 'Vary', 'Origin');
      setHeader(response, 'Access-Control-Allow-Credentials', 'true');
      return h.continue;
    });
  },
};

module.exports = plugin;
