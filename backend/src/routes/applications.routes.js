'use strict';

const svc = require('../services/applications.service');
const { requirePermission, requireTeamScope } = require('../plugins/rbac');
const {
  Joi, M, VALIDATION_OPTIONS, boundedInt, singleMessageFailAction, intIdParam, searchQuery,
  paginationQuery, queryId,
} = require('../validation');
const { clientIp } = require('../utils/clientIp');
const { actorAccess } = require('../services/teamAccess');

// =============================================================================
// applications.routes.js — Aplicaciones (ámbito de equipo APP).
// Prefijo /api/applications.
// =============================================================================

const canRead   = [requirePermission('RES_VIEW'),   requireTeamScope('APP')];
const canWrite  = [requirePermission('RES_EDIT'),   requireTeamScope('APP')];
const canDelete = [requirePermission('RES_DELETE'), requireTeamScope('APP')];

function actor(request) {
  const user = request.auth.credentials;
  return { id: user.id, username: user.username, ip: clientIp(request), ...actorAccess(user) };
}

/**
 * Traduce los errores del servicio a respuestas HTTP.
 * Cualquier error inesperado se convierte en 500 genérico: este módulo nunca
 * expone detalles internos al cliente.
 */
function handleError(h, err) {
  if (err.isValidation) {
    return h.response({ success: false, code: 'VALIDATION_ERROR', message: err.message }).code(400);
  }
  if (err.isNotFound) {
    return h.response({ success: false, code: 'NOT_FOUND', message: err.message }).code(404);
  }
  if (err.isForbidden) {
    return h.response({ success: false, code: 'FORBIDDEN', message: err.message }).code(403);
  }
  // Cualquier otro error se propaga al manejador global (plugins/errors.js).
  // Antes se devolvia aqui un 500 mudo: el fallo no llegaba a los logs y el
  // cuerpo no traia ni success ni code, a diferencia del resto de la API.
  throw err;
}

// Se declaran todos los campos que llegan a la base de datos (ver el mismo
// comentario en resources.routes.js).
//
// La URL merece mención propia. No se validaba en absoluto, y la pantalla de
// aplicaciones la pinta como <a :href="app.url">: quien tuviera RES_EDIT sobre
// aplicaciones podía guardar "javascript:..." y el enlace se ejecutaba en la
// sesión de quien lo pulsara, un ADMIN incluido. En producción lo frena la CSP
// (script-src 'self'), pero en el servidor de desarrollo de Vite no hay CSP.
// Solo se aceptan http y https.
const appSchema = Joi.object({
  name: Joi.string().trim().min(1).max(200).required()
    .messages(M('El nombre es obligatorio y no puede superar 200 caracteres')),
  environmentId: Joi.number().integer().min(1).required().messages(M('El ambiente es obligatorio')),
  appType: Joi.string().valid('WEB', 'API', 'SERVICE', 'OTHER').optional()
    .messages(M('Tipo de app inválido')),
  url: Joi.string().trim().max(500).uri({ scheme: ['http', 'https'] }).allow(null, '').optional()
    .messages(M('La URL debe empezar por http:// o https:// y no superar 500 caracteres')),
  serverId: Joi.number().integer().min(1).allow(null, '').optional()
    .messages(M('El servidor no es válido')),
  description: Joi.string().max(2000).allow(null, '').optional()
    .messages(M('La descripción no puede superar 2000 caracteres')),
});

// Sin validar los params, un {id} no numerico llegaba como NaN a la consulta y
// PostgreSQL respondia 22P02: un 500 provocado por entrada del cliente.
// Listado: se declaran TODOS los parámetros que envía la pantalla. Antes solo
// se declaraba `search` y el resto pasaba sin mirar por allowUnknown; con el
// esquema estricto (validation/index.js), lo que no figura aquí se rechaza.
const validateSearch = {
  query: Joi.object({
    ...paginationQuery,
    search:        searchQuery,
    environmentId: queryId('environmentId'),
    appType: Joi.string().valid('WEB', 'API', 'SERVICE', 'OTHER').allow('')
      .messages(M('appType debe ser WEB, API, SERVICE u OTHER.')),
  }),
  options:    VALIDATION_OPTIONS,
  failAction: singleMessageFailAction,
};

const validateId = {
  params:     intIdParam,
  options:    VALIDATION_OPTIONS,
  failAction: singleMessageFailAction,
};

const validate = {
  payload:    appSchema,
  options:    VALIDATION_OPTIONS,
  failAction: singleMessageFailAction,
};

const validateIdPayload = {
  params:     intIdParam,
  payload:    appSchema,
  options:    VALIDATION_OPTIONS,
  failAction: singleMessageFailAction,
};

/** Campos que acepta el servicio al crear/actualizar una aplicación. */
function appFields(payload) {
  const { name, appType, url, environmentId, serverId, description } = payload;
  return {
    name,
    appType: appType || 'WEB',
    url,
    environmentId,
    serverId: serverId || null,
    description,
  };
}

module.exports = {
  name: 'icm-routes-applications',
  register(server) {
    server.route([
      {
        method: 'GET',
        path: '/',
        options: { auth: 'session', pre: canRead, validate: validateSearch },
        handler: async (request, h) => {
          try {
            const { page = 1, limit = 20, search = '', environmentId, appType } = request.query;
            return await svc.listApplications({
              page:  boundedInt(page,  { def: 1,  min: 1, max: 10000 }),
              limit: boundedInt(limit, { def: 20, min: 1, max: 100 }),
              search,
              environmentId: environmentId ? parseInt(environmentId, 10) : null,
              appType: appType || null,
            });
          } catch (err) { return handleError(h, err); }
        },
      },

      {
        method: 'GET',
        path: '/{id}',
        options: { auth: 'session', pre: canRead, validate: validateId },
        handler: async (request, h) => {
          try {
            return await svc.getApplication(parseInt(request.params.id, 10));
          } catch (err) { return handleError(h, err); }
        },
      },

      {
        method: 'POST',
        path: '/',
        options: { auth: 'session', pre: canWrite, validate },
        handler: async (request, h) => {
          try {
            const app = await svc.createApplication(appFields(request.payload), actor(request));
            return h.response(app).code(201);
          } catch (err) { return handleError(h, err); }
        },
      },

      {
        method: 'PUT',
        path: '/{id}',
        options: { auth: 'session', pre: canWrite, validate: validateIdPayload },
        handler: async (request, h) => {
          try {
            return await svc.updateApplication(
              parseInt(request.params.id, 10),
              appFields(request.payload),
              actor(request)
            );
          } catch (err) { return handleError(h, err); }
        },
      },

      {
        method: 'PATCH',
        path: '/{id}/toggle-estado',
        options: { auth: 'session', pre: canWrite, validate: validateId },
        handler: async (request, h) => {
          try {
            return await svc.toggleApplicationEstado(parseInt(request.params.id, 10), actor(request));
          } catch (err) { return handleError(h, err); }
        },
      },

      {
        method: 'DELETE',
        path: '/{id}',
        options: { auth: 'session', pre: canDelete, validate: validateId },
        handler: async (request, h) => {
          try {
            return await svc.deleteApplication(parseInt(request.params.id, 10), actor(request));
          } catch (err) { return handleError(h, err); }
        },
      },
    ]);
  },
};

// Se exporta para las pruebas: la validación de la URL es lo que impide guardar
// un enlace javascript: que la pantalla pinta dentro de un href.
module.exports.appSchema = appSchema;
