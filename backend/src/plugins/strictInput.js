'use strict';

// =============================================================================
// plugins/strictInput.js — Una ruta sin esquema no admite entrada.
//
// VALIDATION_OPTIONS (validation/index.js) rechaza los campos que un esquema no
// declara. Pero eso solo actúa donde HAY esquema: una ruta sin `validate.query`
// acepta cualquier query string, y una sin `validate.payload` cualquier cuerpo,
// sin que Joi llegue a mirarlos. Ese es el hueco por el que se cuela un handler
// que lee un dato que nadie declaró.
//
// Este plugin cierra ese lado:
//   - query string en una ruta /api/* sin esquema de query  → 400;
//   - cuerpo no vacío en una ruta /api/* sin esquema de cuerpo → 400.
//
// Así, si una ruta nueva olvida su esquema, el síntoma es un 400 inmediato en
// cuanto un cliente le envía datos, y no un campo sin validar que llega a la
// base de datos y aflora rondas después.
//
// Se ejecuta en onPreHandler, cuando la autenticación y la validación de hapi
// ya han terminado: una petición sin sesión sigue recibiendo 401, y las rutas
// con esquema ya han sido juzgadas por Joi. Queda fuera todo lo que no es
// /api/*: el frontend compilado se sirve con query strings arbitrarias (enlaces
// con parámetros de campaña, por ejemplo) y no lee ninguna.
// =============================================================================

// Tope de claves citadas en el mensaje, para no devolver una lista arbitraria.
const MAX_CLAVES_EN_MENSAJE = 5;

function esRutaApi(path) {
  return path === '/api' || path.startsWith('/api/');
}

/** Un cuerpo "vacío" es el que normaliza plugins/payload.js: null o {}. */
function esCuerpoVacio(payload) {
  if (payload === null || payload === undefined) return true;
  if (Buffer.isBuffer(payload) || Array.isArray(payload)) return payload.length === 0;
  if (typeof payload === 'object') return Object.keys(payload).length === 0;
  return payload === '';
}

function rechazo(h, message) {
  return h.response({ success: false, code: 'VALIDATION_ERROR', message }).code(400).takeover();
}

const plugin = {
  name: 'icm-strict-input',
  register(server) {
    server.ext('onPreHandler', (request, h) => {
      if (!esRutaApi(request.path)) return h.continue;

      const validate = request.route.settings.validate || {};

      if (!validate.query) {
        const claves = Object.keys(request.query || {});
        if (claves.length > 0) {
          const citadas = claves.slice(0, MAX_CLAVES_EN_MENSAJE).map((c) => c.slice(0, 40));
          return rechazo(h, `Esta ruta no admite parámetros de consulta: ${citadas.join(', ')}.`);
        }
      }

      const admiteCuerpo = !['get', 'head', 'options'].includes(request.method);
      if (admiteCuerpo && !validate.payload && !esCuerpoVacio(request.payload)) {
        return rechazo(h, 'Esta ruta no admite datos en el cuerpo de la petición.');
      }

      return h.continue;
    });
  },
};

module.exports = plugin;
