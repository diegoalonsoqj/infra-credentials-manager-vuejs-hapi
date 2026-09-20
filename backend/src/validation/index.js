'use strict';

const Joi = require('joi');
const validator = require('validator');

// =============================================================================
// validation/index.js — Utilidades de validación (reemplazo de express-validator).
//
// La validación pasa a declararse con Joi en `options.validate` de cada ruta,
// que es la forma nativa de hapi. Este módulo centraliza:
//
//   - Las opciones de validación:
//       abortEarly: false   → se devuelven TODOS los errores (como errors.array())
//       allowUnknown: false → un campo que el esquema no declara se RECHAZA con
//                             400 (ver el comentario de VALIDATION_OPTIONS).
//       convert: true       → trim y conversión de tipos, como hacían los
//                             sanitizadores .trim() de express-validator.
//
//   - Los dos formatos de error 400 que ya usaba la API, para no cambiar el
//     contrato con el frontend:
//       failAction              → { success:false, code:'VALIDATION_ERROR', errors:[…] }
//       singleMessageFailAction → { success:false, code:'VALIDATION_ERROR', message:'…' }
//       messageFailAction       → { message: '<primer mensaje>' }
//
// Los objetos de `errors[]` conservan la forma de express-validator
// ({ type, value, msg, path, location }) porque el frontend lee
// `err.errors[0].msg` (ver UsersPage.vue).
// =============================================================================

// ESQUEMA ESTRICTO: lo que no se declara, no pasa.
//
// Esto fue allowUnknown: true, heredado de la migración desde
// express-validator, donde req.body llegaba entero a los servicios. Con esa
// opción un esquema solo validaba los campos que alguien se había acordado de
// declarar, y todo lo demás llegaba crudo hasta la base de datos. El mismo
// defecto aparecía una y otra vez en campos distintos, y corregirlos de uno en
// uno no cerraba la clase entera. Esto sí.
//
// Consecuencia: todo campo que envía un cliente legítimo tiene que estar
// declarado. Los que el frontend reenvía pero el backend ignora (el código de
// un registro al editarlo, por ejemplo) se declaran con Joi.any().strip(), de
// modo que quedan documentados y descartados. tests/strict-input.test.js
// valida cada formulario real del frontend contra el esquema de su ruta.
//
// Las rutas que no tienen esquema de query o de cuerpo las cubre
// plugins/strictInput.js, que rechaza cualquier parámetro o cuerpo que les llegue.
const VALIDATION_OPTIONS = {
  abortEarly:   false,
  allowUnknown: false,
  convert:      true,
  messages: {
    'object.unknown': '{{#label}} no es un campo admitido.',
  },
};

/**
 * Mensaje único para cualquier fallo de un campo.
 *
 * Equivale a `.withMessage()` de express-validator, pero aplicado a todas las
 * reglas del campo: así el usuario siempre ve el texto en español en lugar del
 * mensaje por defecto de Joi.
 *
 * @param {string} text
 * @returns {object} Mapa de mensajes para .messages()
 *
 * @example  Joi.string().trim().required().messages(M('El nombre es obligatorio.'))
 */
const M = (text) => ({ '*': text });

// Dónde ocurrió el error, con los nombres que usaba express-validator.
const LOCATION_BY_SOURCE = {
  payload: 'body',
  query:   'query',
  params:  'params',
  headers: 'headers',
};

/**
 * Traduce los detalles de Joi al formato de errors.array() de express-validator.
 *
 * @param {object} err - Error Boom de validación de hapi (con err.details).
 * @returns {Array<object>}
 */
function toValidationErrors(err) {
  const location = LOCATION_BY_SOURCE[err.output?.payload?.validation?.source] || 'body';
  const details  = err.details || [];

  return details.map((detail) => ({
    type:     'field',
    value:    detail.context?.value,
    msg:      detail.message,
    path:     detail.path.join('.'),
    location,
  }));
}

/**
 * failAction estándar: 400 con la lista completa de errores.
 * Es el formato que devolvían auth, catalogs, credentials, users, profile,
 * security, system y setup.
 */
function failAction(request, h, err) {
  return h.response({
    success: false,
    code: 'VALIDATION_ERROR',
    errors: toValidationErrors(err),
  }).code(400).takeover();
}

/**
 * failAction con un único mensaje dentro del sobre estándar.
 * Es el formato que devolvían las comprobaciones manuales de query string
 * (audit, credentials, catalogs): { success, code, message }.
 */
function singleMessageFailAction(request, h, err) {
  const errors = toValidationErrors(err);
  return h.response({
    success: false,
    code: 'VALIDATION_ERROR',
    message: errors[0] ? errors[0].msg : 'Datos inválidos.',
  }).code(400).takeover();
}

/**
 * failAction simplificado: 400 con solo el primer mensaje.
 * Es el formato que devolvían las rutas de recursos y aplicaciones
 * (`res.status(400).json({ message: errors.array()[0].msg })`).
 */
function messageFailAction(request, h, err) {
  const errors = toValidationErrors(err);
  return h.response({
    message: errors[0] ? errors[0].msg : 'Datos inválidos.',
  }).code(400).takeover();
}

// ---------------------------------------------------------------------------
// Esquemas reutilizables
// ---------------------------------------------------------------------------

/**
 * Email validado y normalizado.
 *
 * `validator.normalizeEmail` es exactamente el sanitizador que aplicaba
 * express-validator con .normalizeEmail() (minúsculas y normalización propia
 * de cada proveedor), así que los emails se guardan igual que antes.
 * `validator` es una librería independiente de Express.
 */
const normalizedEmail = Joi.string()
  .email({ tlds: { allow: false } })
  .custom((value) => validator.normalizeEmail(value) || value);


/**
 * Texto de busqueda de los listados.
 *
 * Existe porque `search` no estaba declarado en ningun esquema y, con
 * allowUnknown, llegaba al repositorio tal cual. hapi convierte los parametros
 * repetidos de la query string en un array, asi que `?search=a&search=b`
 * entregaba un array donde el repositorio esperaba texto y reventaba en
 * `.toLowerCase()`: un 500 provocado por una peticion del cliente, la misma
 * clase de defecto que ya se corrigio en los parametros de ruta.
 *
 * Se admite la cadena vacia porque el frontend envia el filtro sin valor
 * cuando esta "sin seleccionar".
 */
const searchQuery = Joi.string().trim().max(200).allow('')
  .messages({
    'string.base': 'search debe ser un unico valor de texto.',
    'string.max':  'search no puede superar 200 caracteres.',
    '*':           'search no es valido.',
  });

/** :id entero positivo — previene inyecciones y valores basura. */
const intIdParam = Joi.object({
  id: Joi.number().integer().min(1).required().messages(M('ID inválido.')),
});

/**
 * :id UUID — previene errores PG 22P02 (invalid input syntax for type uuid)
 * que generarían 500s.
 *
 * @param {string} message - Texto de error específico del recurso.
 */
const uuidParam = (message) => Joi.object({
  id: Joi.string().uuid().required().messages(M(message)),
});

/**
 * Entero de query string acotado, con valor por defecto a prueba de NaN.
 *
 * POR QUE EXISTE:
 *   El patron `Math.max(1, Math.min(parseInt(v, 10), max))` parece defensivo y
 *   no lo es: parseInt('') y parseInt('abc') dan NaN, y NaN se propaga por
 *   Math.min y Math.max sin que ninguno lo atrape. El valor por defecto de la
 *   desestructuracion tampoco ayuda, porque solo actua cuando el parametro es
 *   undefined, y `?limit=` SI llega, como cadena vacia.
 *
 *   Ese NaN acababa en `LIMIT $1 OFFSET $2` y PostgreSQL respondia 22P02
 *   ("sintaxis de entrada no valida para tipo bigint"), que errors.js traduce a
 *   500 DATABASE_ERROR. Un 500 provocado por entrada del cliente, que es la
 *   misma clase de defecto que ya se corrigio en los parametros de ruta.
 *
 * @param {*} value - Valor crudo de la query string.
 * @param {{def: number, min: number, max: number}} bounds
 * @returns {number} Entero dentro de [min, max]; `def` si no es utilizable.
 */
function boundedInt(value, { def, min, max }) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return def;
  return Math.max(min, Math.min(n, max));
}

/**
 * Paginación de los listados, para expandir dentro de un esquema de query.
 *
 * Solo se exige que sean enteros: el acotado a [1, 10000] y [1, 100] lo sigue
 * haciendo cada handler con boundedInt o Math.min/max, así que ?limit=0 o
 * ?limit=5000 se ajustan en vez de rechazarse, igual que antes. La cadena vacía
 * se admite porque ?limit= llega como '' (ver N1).
 *
 * @example Joi.object({ ...paginationQuery, search: searchQuery })
 */
const paginationQuery = {
  page:  Joi.number().integer().allow('').messages(M('page debe ser un número entero.')),
  limit: Joi.number().integer().allow('').messages(M('limit debe ser un número entero.')),
};

/**
 * Filtro opcional por id de catálogo en la query string (environmentId, osId…).
 * La cadena vacía es "sin filtro": el frontend envía el parámetro sin valor.
 *
 * @param {string} name - Nombre del parámetro, para el mensaje.
 */
const queryId = (name) => Joi.number().integer().min(1).allow('')
  .messages(M(`${name} debe ser un entero positivo.`));

module.exports = {
  Joi,
  M,
  VALIDATION_OPTIONS,
  boundedInt,
  failAction,
  singleMessageFailAction,
  messageFailAction,
  toValidationErrors,
  intIdParam,
  uuidParam,
  normalizedEmail,
  searchQuery,
  paginationQuery,
  queryId,
};
