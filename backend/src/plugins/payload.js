'use strict';

// =============================================================================
// plugins/payload.js — Cuerpo vacío normalizado a objeto.
//
// hapi deja request.payload en null cuando la petición no trae cuerpo, mientras
// que el body parser de Express dejaba siempre un objeto vacío. Sin esta
// normalización, un POST/PATCH sin cuerpo haría fallar cualquier handler que
// lea request.payload.<campo>, y la validación devolvería el error genérico de
// Joi sobre el objeto en lugar de los mensajes por campo.
//
// Se ejecuta en onPostAuth, antes de la validación de la ruta.
// =============================================================================

const plugin = {
  name: 'icm-payload',
  register(server) {
    server.ext('onPostAuth', (request, h) => {
      if (request.payload === null || request.payload === undefined) {
        request.payload = {};
      }
      return h.continue;
    });
  },
};

module.exports = plugin;
