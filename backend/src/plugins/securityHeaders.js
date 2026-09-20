'use strict';

// =============================================================================
// plugins/securityHeaders.js — Cabeceras de seguridad HTTP.
//
// Reemplaza a helmet (middleware de Express) escribiendo exactamente el mismo
// juego de cabeceras que producía la configuración anterior:
//   helmet({ contentSecurityPolicy: { directives: {...} },
//            crossOriginEmbedderPolicy: false })
//
// La CSP resultante es la mezcla de las directivas por defecto de helmet con
// las que definía app.js. Se escribe aquí de forma explícita para que el
// contenido real de la cabecera sea revisable sin conocer los valores por
// defecto de una librería externa.
//
// COEP queda desactivado a propósito (CoreUI puede cargar recursos externos),
// igual que antes.
// =============================================================================

// upgrade-insecure-requests solo se emite con HTTPS real: en HTTP local rompe
// la carga de assets.
const HTTPS_ENABLED = process.env.HTTPS_ENABLED === 'true';

const CSP_DIRECTIVES = [
  "default-src 'self'",
  "base-uri 'self'",
  "font-src 'self' data:",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "img-src 'self' data: blob:",
  "object-src 'none'",
  "script-src 'self'",
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline'",   // CoreUI usa estilos inline
  "connect-src 'self'",
  "frame-src 'none'",
  ...(HTTPS_ENABLED ? ['upgrade-insecure-requests'] : []),
];

const SECURITY_HEADERS = {
  'Content-Security-Policy':           CSP_DIRECTIVES.join('; '),
  'Cross-Origin-Opener-Policy':        'same-origin',
  'Cross-Origin-Resource-Policy':      'same-origin',
  'Origin-Agent-Cluster':              '?1',
  'Referrer-Policy':                   'no-referrer',
  'Strict-Transport-Security':         'max-age=15552000; includeSubDomains',
  'X-Content-Type-Options':            'nosniff',
  'X-DNS-Prefetch-Control':            'off',
  'X-Download-Options':                'noopen',
  'X-Frame-Options':                   'SAMEORIGIN',
  'X-Permitted-Cross-Domain-Policies': 'none',
  'X-XSS-Protection':                  '0',
};

const plugin = {
  name: 'icm-security-headers',
  register(server) {
    server.ext('onPreResponse', (request, h) => {
      const response = request.response;
      const target   = response.isBoom ? response.output.headers : null;

      for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        if (target) target[name] = value;
        else response.header(name, value);
      }

      // Las respuestas de la API no se guardan en ninguna caché. hapi pone
      // "no-cache", que permite almacenarlas y solo obliga a revalidar: en un
      // equipo compartido, usuarios, credenciales y perfil quedaban en la caché
      // de disco del navegador.
      if (request.path === '/api' || request.path.startsWith('/api/')) {
        if (target) target['Cache-Control'] = 'no-store';
        else response.header('Cache-Control', 'no-store');
      }

      return h.continue;
    });
  },
};

module.exports = plugin;
module.exports.SECURITY_HEADERS = SECURITY_HEADERS;
