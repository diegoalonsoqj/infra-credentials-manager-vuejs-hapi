'use strict';

const logger       = require('../utils/logger');
const { clientIp } = require('../utils/clientIp');

// =============================================================================
// plugins/requestLogger.js — Log de peticiones HTTP (reemplazo de morgan).
//
// Mantiene el mismo formato de línea que la configuración anterior:
//   :remote-addr :method :url :status :res[content-length] - :response-time ms [:user-id]
//
// Se engancha al evento 'response' del servidor, que se emite cuando la
// respuesta ya se envió: así el status, el content-length y el tiempo son los
// definitivos (morgan también registraba al finalizar la respuesta).
//
// SEGURIDAD: nunca se registra la cabecera Authorization ni la cookie de
// sesión; solo los campos del formato.
// =============================================================================

// El health check se consulta constantemente (monitorización): no se registra.
const SKIP_URL = '/api/health';

function statusOf(response) {
  if (!response) return 0;
  return response.isBoom ? response.output.statusCode : response.statusCode;
}

function contentLengthOf(response) {
  if (!response) return '-';
  const headers = response.isBoom ? response.output.headers : response.headers;
  const value   = headers && headers['content-length'];
  return value === undefined || value === null ? '-' : String(value);
}

const plugin = {
  name: 'icm-request-logger',
  register(server) {
    // En tests el log de requests solo añade ruido (antes: morgan solo se
    // registraba si NODE_ENV !== 'test').
    if (process.env.NODE_ENV === 'test') return;

    server.events.on('response', (request) => {
      const url = request.url.pathname + (request.url.search || '');
      if (url === SKIP_URL) return;

      const responseTime = request.info.completed >= request.info.received
        ? (request.info.completed - request.info.received).toFixed(3)
        : '0.000';

      const username = request.auth?.credentials?.username || 'anonymous';

      logger.info(
        `${clientIp(request)} ${request.method.toUpperCase()} ${url} ` +
        `${statusOf(request.response)} ${contentLengthOf(request.response)} - ` +
        `${responseTime} ms [${username}]`
      );
    });
  },
};

module.exports = plugin;
