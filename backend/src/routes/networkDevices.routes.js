'use strict';

const svc = require('../services/networkDevices.service');
const { requirePermission, requireTeamScope } = require('../plugins/rbac');
const {
  Joi, M, VALIDATION_OPTIONS, boundedInt, singleMessageFailAction, intIdParam, searchQuery,
  paginationQuery, queryId,
} = require('../validation');
const { clientIp } = require('../utils/clientIp');

// =============================================================================
// networkDevices.routes.js — Dispositivos de red (ámbito de equipo NET).
// Prefijo /api/network-devices.
// =============================================================================

const canRead   = [requirePermission('RES_VIEW'),   requireTeamScope('NET')];
const canWrite  = [requirePermission('RES_EDIT'),   requireTeamScope('NET')];
const canDelete = [requirePermission('RES_DELETE'), requireTeamScope('NET')];

function actor(request) {
  const user = request.auth.credentials;
  return { id: user.id, username: user.username, ip: clientIp(request) };
}

function handleError(h, err) {
  if (err.isValidation) {
    return h.response({ success: false, code: 'VALIDATION_ERROR', message: err.message }).code(400);
  }
  if (err.isNotFound) {
    return h.response({ success: false, code: 'NOT_FOUND', message: err.message }).code(404);
  }
  // 23503: el ambiente, la infraestructura o el producto enviado no existe. Es
  // entrada del cliente, no un fallo del servidor.
  if (err.code === '23503') {
    return h.response({
      success: false, code: 'VALIDATION_ERROR',
      message: 'El ambiente, la infraestructura o el producto indicado no existe.',
    }).code(400);
  }
  throw err;
}

// Las tres columnas son SMALLINT: sin el máximo, un id mayor que 32767 llegaba a
// PostgreSQL y terminaba en un 500 (22003) en vez de un 400.
const SMALLINT_MAX = 32767;

/** Id opcional de catálogo: el formulario envía '' cuando no se selecciona. */
const optionalId = (label) => Joi.number().integer().min(1).max(SMALLINT_MAX).allow(null, '').optional()
  .messages(M(`${label} no es válido`));

// Se declaran todos los campos que llegan a la base de datos, con las
// longitudes de las columnas (migración 019), para que una entrada inválida
// sea un 400 y no un 500 de PostgreSQL.
const deviceSchema = Joi.object({
  name: Joi.string().trim().min(1).max(200).required()
    .messages(M('El nombre es obligatorio y no puede superar 200 caracteres')),
  host: Joi.string().trim().min(1).max(300).required()
    .messages(M('La IP o host es obligatorio y no puede superar 300 caracteres')),
  port: Joi.number().integer().min(1).max(65535).allow(null, '').optional()
    .messages(M('El puerto debe ser un entero entre 1 y 65535')),
  environmentId:    Joi.number().integer().min(1).max(SMALLINT_MAX).required().messages(M('El ambiente es obligatorio')),
  infrastructureId: optionalId('La infraestructura'),
  productId:        optionalId('El producto'),
  description: Joi.string().max(2000).allow(null, '').optional()
    .messages(M('La descripción no puede superar 2000 caracteres')),
});

const validateSearch = {
  query: Joi.object({
    ...paginationQuery,
    search:           searchQuery,
    environmentId:    queryId('environmentId'),
    infrastructureId: queryId('infrastructureId'),
    productId:        queryId('productId'),
  }),
  options:    VALIDATION_OPTIONS,
  failAction: singleMessageFailAction,
};

const validateId = { params: intIdParam, options: VALIDATION_OPTIONS, failAction: singleMessageFailAction };
const validate = { payload: deviceSchema, options: VALIDATION_OPTIONS, failAction: singleMessageFailAction };
const validateIdPayload = {
  params: intIdParam, payload: deviceSchema, options: VALIDATION_OPTIONS, failAction: singleMessageFailAction,
};

/** Campos que acepta el servicio al crear/actualizar un dispositivo. */
function deviceFields(payload) {
  const { name, host, port, environmentId, infrastructureId, productId, description } = payload;
  return {
    name, host,
    port: port || null,
    environmentId,
    infrastructureId: infrastructureId || null,
    productId:        productId        || null,
    description,
  };
}

const intOrNull = (value) => (value ? parseInt(value, 10) : null);

module.exports = {
  name: 'icm-routes-network-devices',
  register(server) {
    server.route([
      // Lo que necesita el formulario: ambientes, infraestructuras y productos
      // de red. /api/resources/catalogs también los da, pero con otras seis
      // consultas (SO, productos de BD, servidores…) que esta página no usa.
      {
        method: 'GET',
        path: '/catalogs',
        options: { auth: 'session', pre: canRead },
        handler: async (request, h) => {
          try { return await svc.getCatalogs(); } catch (err) { return handleError(h, err); }
        },
      },
      {
        method: 'GET',
        path: '/',
        options: { auth: 'session', pre: canRead, validate: validateSearch },
        handler: async (request, h) => {
          try {
            const { page = 1, limit = 20, search = '', environmentId, infrastructureId, productId } = request.query;
            return await svc.listDevices({
              page:  boundedInt(page,  { def: 1,  min: 1, max: 10000 }),
              limit: boundedInt(limit, { def: 20, min: 1, max: 100 }),
              search,
              environmentId:    intOrNull(environmentId),
              infrastructureId: intOrNull(infrastructureId),
              productId:        intOrNull(productId),
            });
          } catch (err) { return handleError(h, err); }
        },
      },
      {
        method: 'GET',
        path: '/{id}',
        options: { auth: 'session', pre: canRead, validate: validateId },
        handler: async (request, h) => {
          try { return await svc.getDevice(parseInt(request.params.id, 10)); } catch (err) { return handleError(h, err); }
        },
      },
      {
        method: 'POST',
        path: '/',
        options: { auth: 'session', pre: canWrite, validate },
        handler: async (request, h) => {
          try {
            const device = await svc.createDevice(deviceFields(request.payload), actor(request));
            return h.response(device).code(201);
          } catch (err) { return handleError(h, err); }
        },
      },
      {
        method: 'PUT',
        path: '/{id}',
        options: { auth: 'session', pre: canWrite, validate: validateIdPayload },
        handler: async (request, h) => {
          try {
            return await svc.updateDevice(parseInt(request.params.id, 10), deviceFields(request.payload), actor(request));
          } catch (err) { return handleError(h, err); }
        },
      },
      {
        method: 'PATCH',
        path: '/{id}/toggle-estado',
        options: { auth: 'session', pre: canWrite, validate: validateId },
        handler: async (request, h) => {
          try {
            return await svc.toggleDeviceEstado(parseInt(request.params.id, 10), actor(request));
          } catch (err) { return handleError(h, err); }
        },
      },
      {
        method: 'DELETE',
        path: '/{id}',
        options: { auth: 'session', pre: canDelete, validate: validateId },
        handler: async (request, h) => {
          try {
            return await svc.deleteDevice(parseInt(request.params.id, 10), actor(request));
          } catch (err) { return handleError(h, err); }
        },
      },
    ]);
  },
};

module.exports.deviceSchema = deviceSchema;
