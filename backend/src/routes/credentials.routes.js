'use strict';

const ctrl = require('../controllers/credentials.controller');
const { requirePermission } = require('../plugins/rbac');
const { rateLimitPre, userKey } = require('../plugins/rateLimit');
const { DECRYPT } = require('../config/rateLimits');
const { VALIDATION_OPTIONS, failAction, singleMessageFailAction } = require('../validation');

// =============================================================================
// credentials.routes.js — Gestión de credenciales. Prefijo /api/credentials.
// =============================================================================

// Rate limiting específico para descifrado (operación CPU-intensiva con pgcrypto).
//
// Se cuenta POR USUARIO, no por IP: el pre corre después de la autenticación, y
// a esta ruta no se llega sin sesión. Contar por IP repartía los 10/min entre
// todos los usuarios que salen por el mismo NAT corporativo, y a la vez dejaba
// sin acotar lo que puede extraer una sola cuenta desde varias IP.
const decryptLimiter = rateLimitPre({ ...DECRYPT, keyOf: userKey });

const validate = (parts, fail = failAction) => ({
  ...parts,
  options: VALIDATION_OPTIONS,
  failAction: fail,
});

module.exports = {
  name: 'icm-routes-credentials',
  register(server) {
    server.route([
      // Catálogos (instancias BD + apps disponibles + usuarios para custodio)
      {
        method: 'GET',
        path: '/catalogs',
        options: {
          auth: 'session',
          pre: [requirePermission('CRED_VIEW')],
        },
        handler: ctrl.getCatalogs,
      },

      // Listado y detalle
      {
        method: 'GET',
        path: '/',
        options: {
          auth: 'session',
          pre: [requirePermission('CRED_VIEW')],
          validate: validate({ query: ctrl.listQuerySchema }, singleMessageFailAction),
        },
        handler: ctrl.listCredentials,
      },
      {
        method: 'GET',
        path: '/{id}',
        options: {
          auth: 'session',
          pre: [requirePermission('CRED_VIEW')],
          validate: validate({ params: ctrl.credentialIdParam }),
        },
        handler: ctrl.getCredential,
      },

      // Descifrado — permiso explícito CRED_REVEAL, siempre auditado
      {
        method: 'POST',
        path: '/{id}/decrypt',
        options: {
          auth: 'session',
          pre: [requirePermission('CRED_REVEAL'), decryptLimiter],
          validate: validate({ params: ctrl.credentialIdParam, payload: ctrl.decryptSchema }),
        },
        handler: ctrl.decryptPassword,
      },

      // Creación y edición
      {
        method: 'POST',
        path: '/',
        options: {
          auth: 'session',
          pre: [requirePermission('CRED_EDIT')],
          validate: validate({ payload: ctrl.createSchema }),
        },
        handler: ctrl.createCredential,
      },
      {
        method: 'PUT',
        path: '/{id}',
        options: {
          auth: 'session',
          pre: [requirePermission('CRED_EDIT')],
          validate: validate({ params: ctrl.credentialIdParam, payload: ctrl.updateSchema }),
        },
        handler: ctrl.updateCredential,
      },
      {
        method: 'PATCH',
        path: '/{id}/toggle-estado',
        options: {
          auth: 'session',
          pre: [requirePermission('CRED_EDIT')],
          validate: validate({ params: ctrl.credentialIdParam }),
        },
        handler: ctrl.toggleEstado,
      },
      {
        method: 'PATCH',
        path: '/{id}/custodian',
        options: {
          auth: 'session',
          pre: [requirePermission('CRED_EDIT')],
          validate: validate({
            params:  ctrl.credentialIdParam,
            payload: ctrl.reassignCustodianSchema,
          }),
        },
        handler: ctrl.reassignCustodian,
      },
      {
        method: 'DELETE',
        path: '/{id}',
        options: {
          auth: 'session',
          pre: [requirePermission('CRED_DELETE')],
          validate: validate({ params: ctrl.credentialIdParam }),
        },
        handler: ctrl.deleteCredential,
      },
    ]);
  },
};
