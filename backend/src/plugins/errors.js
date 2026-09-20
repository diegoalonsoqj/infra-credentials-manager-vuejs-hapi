'use strict';

const logger = require('../utils/logger');

// =============================================================================
// plugins/errors.js — 404 y manejo global de errores.
//
// Sustituye a los middlewares notFound / errorHandler de Express con una única
// extensión onPreResponse, y conserva exactamente los mismos códigos, cuerpos
// JSON y reglas de exposición:
//
// 1. NUNCA exponer stack traces, mensajes PG ni detalles internos en producción.
// 2. Loguear SOLO metadata del error (code, message técnico) en el servidor.
// 3. El cliente solo recibe mensajes genéricos y codes estructurados.
// 4. Los códigos de error PG (5 chars: letras/números) se detectan y
//    retornan 500 DATABASE_ERROR sin detalles del motor.
//
// hapi convierte con Boom cualquier error lanzado por un handler, pero conserva
// las propiedades del error original (code, name, message, stack), así que las
// mismas comprobaciones que hacía errorHandler siguen siendo válidas.
//
// Esta extensión debe registrarse ANTES que las que añaden cabeceras (CORS,
// seguridad, rate limit): al reemplazar la respuesta Boom por una nueva, las
// cabeceras puestas antes se perderían.
// =============================================================================

// Regex para detectar códigos de error PostgreSQL
// Los códigos PG son de 5 caracteres alfanuméricos (ej: 23505, 28P01, 3D000)
const PG_ERROR_CODE_REGEX = /^[0-9A-Z]{5}$/;

// Nombre de la columna en conflicto dentro del DETAIL de un error 23505.
// PostgreSQL lo emite como: «Ya existe la llave (username)=(pepe).» —el texto
// está traducido según el locale del servidor, pero la parte entre paréntesis
// no lo está, así que se extrae solo esa.
const PG_DUPLICATE_COLUMN_REGEX = /\(([^)]+)\)=/;

// Cómo se llama cada columna de cara al usuario. Lo que no esté aquí se nombra
// de forma genérica: es preferible a mostrar el nombre crudo de una columna.
const CAMPOS_LEGIBLES = {
  username: 'nombre de usuario',
  email:    'correo electrónico',
  code:     'código',
};

/**
 * Mensaje de una violación de unicidad.
 *
 * Se nombra el CAMPO, nunca el valor ni el nombre de la restricción: el campo
 * es lo que el usuario necesita para corregir, y lo demás solo describe el
 * esquema. Se menciona el caso del registro eliminado porque es, con diferencia,
 * la forma más habitual de llegar aquí sin entender por qué.
 */
function duplicateMessage(err) {
  const match  = typeof err.detail === 'string' ? err.detail.match(PG_DUPLICATE_COLUMN_REGEX) : null;
  const columna = match ? match[1].split(',')[0].trim() : null;
  const campo   = (columna && CAMPOS_LEGIBLES[columna]) || null;

  const sujeto = campo ? `Ese ${campo}` : 'Ese valor';
  return `${sujeto} ya está en uso. Puede pertenecer a un registro eliminado: ` +
         'al borrarse no se libera, para no reutilizar identidades que ya aparecen ' +
         'en el historial de auditoría.';
}

/** URL completa con query string (equivalente a req.originalUrl de Express). */
function originalUrl(request) {
  return request.url.pathname + (request.url.search || '');
}

/**
 * Respuesta 404 — Ruta no encontrada.
 */
function notFound(request, h) {
  const url = originalUrl(request);
  logger.debug('Ruta no encontrada.', { method: request.method.toUpperCase(), url });

  return h.response({
    success: false,
    code: 'NOT_FOUND',
    message: `Ruta no encontrada: ${request.method.toUpperCase()} ${url}`,
  }).code(404);
}

/**
 * Traduce un error Boom al status y al cuerpo JSON que espera el frontend.
 *
 * @returns {{status: number, body: object}}
 */
function mapError(err, isDev) {
  // Cuerpo JSON malformado (antes: err.type === 'entity.parse.failed')
  if (err.output.statusCode === 400 && err.message === 'Invalid request payload JSON format') {
    return {
      status: 400,
      body: {
        success: false,
        code: 'INVALID_JSON',
        message: 'El cuerpo de la solicitud no es JSON válido.',
      },
    };
  }

  // Content-Type no admitido: la API solo acepta JSON (ver routes.payload.allow).
  // Sin este caso, el 415 saldría etiquetado como INTERNAL_ERROR y el cliente no
  // sabría qué corregir.
  if (err.output.statusCode === 415) {
    return {
      status: 415,
      body: {
        success: false,
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'El cuerpo de la solicitud debe enviarse como application/json.',
      },
    };
  }

  // Cuerpo mayor que el límite (routes.payload.maxBytes). Mismo caso que el 415:
  // salía como INTERNAL_ERROR "Error interno del servidor", aunque el status ya
  // era 413.
  if (err.output.statusCode === 413) {
    return {
      status: 413,
      body: {
        success: false,
        code: 'PAYLOAD_TOO_LARGE',
        message: 'El cuerpo de la solicitud supera el tamaño máximo permitido.',
      },
    };
  }

  // Error de JWT
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return {
      status: 401,
      body: {
        success: false,
        code: 'UNAUTHORIZED',
        message: 'Token de autenticación inválido o expirado.',
      },
    };
  }

  // Violación de unicidad (23505): NO es un error del servidor.
  //
  // Todos los chequeos previos de duplicados —existsByCode,
  // existsByUsernameOrEmail— filtran estado_registro = 'O', es decir, dan por
  // libre el codigo de un registro eliminado logicamente. Pero las
  // restricciones UNIQUE de las columnas NO llevan ese filtro y cubren tambien
  // los borrados. Resultado: el chequeo dice que el codigo esta libre, el
  // INSERT posterior falla, y el administrador recibia un 500 "Error interno
  // del servidor" sin ninguna pista de que ese codigo pertenece a algo que el
  // mismo borro.
  //
  // Se responde 409 con el campo en conflicto. Cubre de una vez las 17
  // restricciones UNIQUE del esquema, y tambien la carrera entre dos peticiones
  // simultaneas que pasen el chequeo a la vez.
  if (err.code === '23505') {
    return {
      status: 409,
      body: {
        success: false,
        code: 'DUPLICATE_VALUE',
        message: duplicateMessage(err),
      },
    };
  }

  // Error de PostgreSQL: detectado por código PG de 5 chars
  if (err.code && PG_ERROR_CODE_REGEX.test(err.code)) {
    return {
      status: 500,
      body: {
        success: false,
        code: 'DATABASE_ERROR',
        message: 'Error interno del servidor.',
        // En desarrollo: incluir el código PG para debugging
        ...(isDev && { pgCode: err.code }),
      },
    };
  }

  // Error de conexión a BD
  if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
    return {
      status: 503,
      body: {
        success: false,
        code: 'SERVICE_UNAVAILABLE',
        message: 'El servicio no está disponible temporalmente.',
      },
    };
  }

  // Error genérico
  return {
    status: err.status || err.statusCode || err.output.statusCode || 500,
    body: {
      success: false,
      code: err.code || 'INTERNAL_ERROR',
      message: isDev ? err.message : 'Error interno del servidor.',
      ...(isDev && { stack: err.stack }),
    },
  };
}

/**
 * Registra el error con el nivel que le corresponde.
 *
 * Un 4xx es un fallo del cliente (Content-Type incorrecto, JSON malformado…), no
 * del servidor: se registra como aviso y sin stack trace. De lo contrario
 * cualquiera podría llenar el log de errores con stacks a base de peticiones mal
 * formadas, enterrando los fallos reales.
 *
 * NUNCA se loguea el objeto de error completo en producción.
 */
function logError(request, err, status, isDev) {
  const url    = originalUrl(request);
  const method = request.method.toUpperCase();

  if (status < 500) {
    logger.warn('Petición rechazada:', { status, code: err.code, url, method });
    return;
  }

  if (isDev) {
    logger.error('Error no manejado:', {
      code: err.code,
      message: err.message,
      stack: err.stack,
      url,
      method,
    });
  } else {
    logger.error('Error no manejado:', {
      code: err.code,
      url,
      method,
      // En producción: solo el tipo de error, sin mensaje completo
      type: err.constructor?.name,
    });
  }
}

function errorResponse(request, h, err) {
  const isDev = process.env.NODE_ENV === 'development';
  const { status, body } = mapError(err, isDev);

  logError(request, err, status, isDev);

  return h.response(body).code(status);
}

/**
 * Plugin de errores.
 *
 * @param {object} server
 * @param {object} options
 * @param {string} [options.spaIndexPath] - Ruta a index.html del frontend
 *        compilado. Si se indica, los 404 de GET fuera de /api devuelven el
 *        index (fallback de la SPA). Requiere @hapi/inert registrado.
 */
const plugin = {
  name: 'icm-errors',
  register(server, options) {
    const spaIndexPath = options.spaIndexPath || null;

    server.ext('onPreResponse', (request, h) => {
      const response = request.response;
      if (!response.isBoom) return h.continue;

      if (response.output.statusCode === 404) {
        // Fallback de la SPA: cualquier ruta que no sea /api/* se resuelve con
        // index.html para que el router de Vue tome el control.
        if (spaIndexPath &&
            request.method === 'get' &&
            !request.path.startsWith('/api')) {
          return h.file(spaIndexPath, { confine: false });
        }
        return notFound(request, h);
      }

      return errorResponse(request, h, response);
    });
  },
};

module.exports = plugin;

// Se exporta para las pruebas: la traduccion de errores de PostgreSQL a
// respuestas HTTP es contrato de la API y merece cobertura directa.
module.exports.mapError = mapError;
