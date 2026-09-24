'use strict';

const svc = require('../services/resources.service');
const { requirePermission, requireTeamScope } = require('../plugins/rbac');
const {
  Joi, M, VALIDATION_OPTIONS, boundedInt, singleMessageFailAction, intIdParam, searchQuery,
  paginationQuery, queryId,
} = require('../validation');
const { clientIp } = require('../utils/clientIp');
const { actorAccess } = require('../services/teamAccess');

// =============================================================================
// resources.routes.js — Servidores (equipo OS) y servicios de BD (equipo DB).
// Prefijo /api/resources.
// =============================================================================

// ---------------------------------------------------------------------------
// Guards de acceso
// ---------------------------------------------------------------------------
const canReadDB   = [requirePermission('RES_VIEW'),   requireTeamScope('DB')];
const canWriteDB  = [requirePermission('RES_EDIT'),   requireTeamScope('DB')];
const canDeleteDB = [requirePermission('RES_DELETE'), requireTeamScope('DB')];

const canReadOS   = [requirePermission('RES_VIEW'),   requireTeamScope('OS')];
const canWriteOS  = [requirePermission('RES_EDIT'),   requireTeamScope('OS')];
const canDeleteOS = [requirePermission('RES_DELETE'), requireTeamScope('OS')];

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

/** Entero de query string opcional (null cuando no se envía). */
const intOrNull = (value) => (value ? parseInt(value, 10) : null);

// Sin validar los params, un {id} no numerico llegaba como NaN a la consulta y
// PostgreSQL respondia 22P02: un 500 provocado por entrada del cliente.
const validateId = {
  params:     intIdParam,
  options:    VALIDATION_OPTIONS,
  failAction: singleMessageFailAction,
};

// Listados: se declaran TODOS los parámetros que envía cada pantalla. Antes solo
// se declaraba `search` y el resto pasaba sin mirar por allowUnknown; con el
// esquema estricto (validation/index.js), lo que no figura aquí se rechaza.
const listValidate = (filters) => ({
  query:      Joi.object({ ...paginationQuery, search: searchQuery, ...filters }),
  options:    VALIDATION_OPTIONS,
  failAction: singleMessageFailAction,
});

const validateServerList = listValidate({
  environmentId:    queryId('environmentId'),
  infrastructureId: queryId('infrastructureId'),
  productId:        queryId('productId'),
  osId:             queryId('osId'),
});

const validateDbServiceList = listValidate({
  environmentId:    queryId('environmentId'),
  infrastructureId: queryId('infrastructureId'),
  productId:        queryId('productId'),
  engineId:         queryId('engineId'),
  estado: Joi.string().valid('AI', 'IN').allow('').messages(M('estado debe ser AI o IN.')),
});

const validateWith = (payload) => ({
  payload,
  options:    VALIDATION_OPTIONS,
  failAction: singleMessageFailAction,
});

const validateIdWith = (payload) => ({
  params:     intIdParam,
  payload,
  options:    VALIDATION_OPTIONS,
  failAction: singleMessageFailAction,
});

// ---------------------------------------------------------------------------
// Esquemas
// ---------------------------------------------------------------------------
//
// Se declaran TODOS los campos que llegan a la base de datos. Antes solo se
// validaban los obligatorios, y con allowUnknown el resto pasaba tal cual hasta
// el INSERT: una IP inválida (columna INET, 22P02), un puerto fuera de rango
// (22003), un id no numérico (22P02) o un nombre más largo que su VARCHAR
// (22001) terminaban en un 500 provocado por la entrada del cliente.
// Las longitudes máximas son las de las columnas (migración 004).

/** Id opcional de catálogo: el formulario envía '' cuando no se selecciona. */
const optionalId = (label) => Joi.number().integer().min(1).allow(null, '').optional()
  .messages(M(`${label} no es válido`));

const descriptionField = Joi.string().max(2000).allow(null, '').optional()
  .messages(M('La descripción no puede superar 2000 caracteres'));

const serverSchema = Joi.object({
  hostname: Joi.string().trim().min(1).max(200).required()
    .messages(M('El hostname es obligatorio y no puede superar 200 caracteres')),
  name:     Joi.string().trim().min(1).max(200).required()
    .messages(M('El nombre es obligatorio y no puede superar 200 caracteres')),
  ipAddress: Joi.string().trim().ip({ cidr: 'optional' }).allow(null, '').optional()
    .messages(M('La dirección IP no es válida')),
  environmentId: Joi.number().integer().min(1).required().messages(M('El ambiente es obligatorio')),
  infrastructureId: optionalId('La infraestructura'),
  projectId:        optionalId('El proyecto'),
  productId:        optionalId('El producto'),
  osId:             optionalId('El sistema operativo'),
  description:      descriptionField,
});

const dbServiceSchema = Joi.object({
  name: Joi.string().trim().min(1).max(200).required()
    .messages(M('El nombre es obligatorio y no puede superar 200 caracteres')),
  host: Joi.string().trim().min(1).max(300).required()
    .messages(M('El host/endpoint es obligatorio y no puede superar 300 caracteres')),
  // Rango TCP completo. La columna era SMALLINT (máx. 32767) y rechazaba con un
  // 500 puertos legítimos como el 50000 de DB2; la migración 014 la amplía.
  port: Joi.number().integer().min(1).max(65535).allow(null, '').optional()
    .messages(M('El puerto debe ser un entero entre 1 y 65535')),
  environmentId: Joi.number().integer().min(1).required().messages(M('El ambiente es obligatorio')),
  infrastructureId: optionalId('La infraestructura'),
  projectId:        optionalId('El proyecto'),
  productId:        optionalId('El producto'),
  engineId:         optionalId('El motor de base de datos'),
  serverId:         optionalId('El servidor'),
  description:      descriptionField,
});

/** Campos que acepta el servicio al crear/actualizar un servidor. */
function serverFields(payload) {
  const { hostname, name, ipAddress, infrastructureId, environmentId,
          projectId, productId, osId, description } = payload;
  return {
    hostname, name, ipAddress,
    infrastructureId: infrastructureId || null,
    environmentId,
    projectId: projectId || null,
    productId: productId || null,
    osId:      osId      || null,
    description,
  };
}

/** Campos que acepta el servicio al crear/actualizar un servicio de BD. */
function dbServiceFields(payload) {
  const { name, host, port, infrastructureId, environmentId,
          projectId, productId, engineId, serverId, description } = payload;
  return {
    name, host,
    port: port || null,
    infrastructureId: infrastructureId || null,
    environmentId,
    projectId: projectId || null,
    productId: productId || null,
    engineId:  engineId  || null,
    serverId:  serverId  || null,
    description,
  };
}

module.exports = {
  name: 'icm-routes-resources',
  register(server) {
    server.route([
      // ---------------------------------------------------------------------
      // Catálogos compartidos (ambientes, infraestructuras, OS, productos,
      // motores, servidores). Accesible para cualquier usuario con RES_VIEW.
      // ---------------------------------------------------------------------
      {
        method: 'GET',
        path: '/catalogs',
        options: { auth: 'session', pre: [requirePermission('RES_VIEW')] },
        handler: async (request, h) => {
          try {
            return await svc.getCatalogs();
          } catch (err) { return handleError(h, err); }
        },
      },

      // ---------------------------------------------------------------------
      // Servidores — equipo OS
      // ---------------------------------------------------------------------
      {
        method: 'GET',
        path: '/servers',
        options: { auth: 'session', pre: canReadOS, validate: validateServerList },
        handler: async (request, h) => {
          try {
            const { page = 1, limit = 20, search = '', environmentId,
                    infrastructureId, productId, osId } = request.query;
            return await svc.listServers({
              page:  boundedInt(page,  { def: 1,  min: 1, max: 10000 }),
              limit: boundedInt(limit, { def: 20, min: 1, max: 100 }),
              search,
              environmentId:    intOrNull(environmentId),
              infrastructureId: intOrNull(infrastructureId),
              productId:        intOrNull(productId),
              osId:             intOrNull(osId),
            });
          } catch (err) { return handleError(h, err); }
        },
      },
      {
        method: 'GET',
        path: '/servers/{id}',
        options: { auth: 'session', pre: canReadOS, validate: validateId },
        handler: async (request, h) => {
          try {
            return await svc.getServer(parseInt(request.params.id, 10));
          } catch (err) { return handleError(h, err); }
        },
      },
      {
        method: 'POST',
        path: '/servers',
        options: { auth: 'session', pre: canWriteOS, validate: validateWith(serverSchema) },
        handler: async (request, h) => {
          try {
            const created = await svc.createServer(serverFields(request.payload), actor(request));
            return h.response(created).code(201);
          } catch (err) { return handleError(h, err); }
        },
      },
      {
        method: 'PUT',
        path: '/servers/{id}',
        options: { auth: 'session', pre: canWriteOS, validate: validateIdWith(serverSchema) },
        handler: async (request, h) => {
          try {
            return await svc.updateServer(
              parseInt(request.params.id, 10),
              serverFields(request.payload),
              actor(request)
            );
          } catch (err) { return handleError(h, err); }
        },
      },
      {
        method: 'PATCH',
        path: '/servers/{id}/toggle-estado',
        options: { auth: 'session', pre: canWriteOS, validate: validateId },
        handler: async (request, h) => {
          try {
            return await svc.toggleServerEstado(parseInt(request.params.id, 10), actor(request));
          } catch (err) { return handleError(h, err); }
        },
      },
      {
        method: 'DELETE',
        path: '/servers/{id}',
        options: { auth: 'session', pre: canDeleteOS, validate: validateId },
        handler: async (request, h) => {
          try {
            return await svc.deleteServer(parseInt(request.params.id, 10), actor(request));
          } catch (err) { return handleError(h, err); }
        },
      },

      // ---------------------------------------------------------------------
      // Servicios de BD — equipo DB
      // ---------------------------------------------------------------------
      {
        method: 'GET',
        path: '/db-services',
        options: { auth: 'session', pre: canReadDB, validate: validateDbServiceList },
        handler: async (request, h) => {
          try {
            const { page = 1, limit = 20, search = '', environmentId, engineId,
                    estado, productId, infrastructureId } = request.query;
            return await svc.listDbServices({
              page:  boundedInt(page,  { def: 1,  min: 1, max: 10000 }),
              limit: boundedInt(limit, { def: 20, min: 1, max: 100 }),
              search,
              environmentId:    intOrNull(environmentId),
              engineId:         intOrNull(engineId),
              estado:           estado || null,
              productId:        intOrNull(productId),
              infrastructureId: intOrNull(infrastructureId),
            });
          } catch (err) { return handleError(h, err); }
        },
      },
      {
        method: 'GET',
        path: '/db-services/{id}',
        options: { auth: 'session', pre: canReadDB, validate: validateId },
        handler: async (request, h) => {
          try {
            return await svc.getDbService(parseInt(request.params.id, 10));
          } catch (err) { return handleError(h, err); }
        },
      },
      {
        method: 'POST',
        path: '/db-services',
        options: { auth: 'session', pre: canWriteDB, validate: validateWith(dbServiceSchema) },
        handler: async (request, h) => {
          try {
            const created = await svc.createDbService(dbServiceFields(request.payload), actor(request));
            return h.response(created).code(201);
          } catch (err) { return handleError(h, err); }
        },
      },
      {
        method: 'PUT',
        path: '/db-services/{id}',
        options: { auth: 'session', pre: canWriteDB, validate: validateIdWith(dbServiceSchema) },
        handler: async (request, h) => {
          try {
            return await svc.updateDbService(
              parseInt(request.params.id, 10),
              dbServiceFields(request.payload),
              actor(request)
            );
          } catch (err) { return handleError(h, err); }
        },
      },
      {
        method: 'PATCH',
        path: '/db-services/{id}/toggle-estado',
        options: { auth: 'session', pre: canWriteDB, validate: validateId },
        handler: async (request, h) => {
          try {
            return await svc.toggleDbServiceEstado(parseInt(request.params.id, 10), actor(request));
          } catch (err) { return handleError(h, err); }
        },
      },
      {
        method: 'DELETE',
        path: '/db-services/{id}',
        options: { auth: 'session', pre: canDeleteDB, validate: validateId },
        handler: async (request, h) => {
          try {
            return await svc.deleteDbService(parseInt(request.params.id, 10), actor(request));
          } catch (err) { return handleError(h, err); }
        },
      },
    ]);
  },
};

// Se exportan para las pruebas: son la única barrera entre el formulario y los
// tipos de columna de la base de datos.
module.exports.serverSchema = serverSchema;
module.exports.dbServiceSchema = dbServiceSchema;
