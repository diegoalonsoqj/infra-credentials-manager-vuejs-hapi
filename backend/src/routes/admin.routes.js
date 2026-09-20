'use strict';

const ctrl = require('../controllers/users.controller');
const { requirePermission, requireMinLevel } = require('../plugins/rbac');
const { ROLE_LEVELS } = require('../config/constants');
const { VALIDATION_OPTIONS, failAction } = require('../validation');
const { rateLimitPre, userKey } = require('../plugins/rateLimit');
const { PASSWORD_ADMIN } = require('../config/rateLimits');

// =============================================================================
// admin.routes.js — Administración de usuarios. Prefijo /api/admin.
//
// Todos los endpoints requieren autenticación, permiso MOD_USERS y nivel ADMIN.
//
// El nivel se exige además del permiso —igual que en security.routes.js y
// system.routes.js— porque MOD_USERS permite crear usuarios y asignarles rol:
// quien lo tuviera sin ser ADMIN podría fabricarse un ADMIN y quedarse con el
// control del sistema. Así, conceder el permiso a otro rol no abre esa puerta.
// =============================================================================

const guardUsersModule = [
  requirePermission('MOD_USERS'),
  requireMinLevel(ROLE_LEVELS.ADMIN),
];

// Opciones base compartidas por todas las rutas del módulo.
const guarded = (extra = {}) => ({
  auth: 'session',
  pre: guardUsersModule,
  ...extra,
});

const validate = (parts) => ({
  ...parts,
  options: VALIDATION_OPTIONS,
  failAction,
});

// Las dos rutas que ejecutan bcrypt f14 comparten limitador a proposito: lo que
// se acota es el gasto de CPU por administrador, no el de cada endpoint por
// separado. Se cuenta por usuario, igual que el descifrado.
const passwordLimiter = rateLimitPre({ ...PASSWORD_ADMIN, keyOf: userKey });

module.exports = {
  name: 'icm-routes-admin',
  register(server) {
    server.route([
      {
        method: 'GET',
        path: '/users',
        options: guarded({ validate: validate({ query: ctrl.listQuerySchema }) }),
        handler: ctrl.listUsers,
      },
      {
        method: 'GET',
        path: '/users/catalogs',
        options: guarded(),
        handler: ctrl.getCatalogs,
      },
      {
        method: 'GET',
        path: '/users/{id}',
        options: guarded({ validate: validate({ params: ctrl.userIdParam }) }),
        handler: ctrl.getUser,
      },
      {
        method: 'POST',
        path: '/users',
        options: guarded({
          pre: [...guardUsersModule, passwordLimiter],
          validate: validate({ payload: ctrl.createSchema }),
        }),
        handler: ctrl.createUser,
      },
      {
        method: 'PUT',
        path: '/users/{id}',
        options: guarded({
          validate: validate({ params: ctrl.userIdParam, payload: ctrl.updateSchema }),
        }),
        handler: ctrl.updateUser,
      },
      {
        method: 'PATCH',
        path: '/users/{id}/toggle-estado',
        options: guarded({ validate: validate({ params: ctrl.userIdParam }) }),
        handler: ctrl.toggleEstado,
      },
      {
        method: 'DELETE',
        path: '/users/{id}',
        options: guarded({ validate: validate({ params: ctrl.userIdParam }) }),
        handler: ctrl.deleteUser,
      },
      {
        method: 'POST',
        path: '/users/{id}/reset-password',
        options: guarded({
          pre: [...guardUsersModule, passwordLimiter],
          validate: validate({ params: ctrl.userIdParam, payload: ctrl.resetPasswordSchema }),
        }),
        handler: ctrl.resetPassword,
      },
      {
        method: 'POST',
        path: '/users/{id}/mfa/reset',
        options: guarded({ validate: validate({ params: ctrl.userIdParam }) }),
        handler: ctrl.resetMfa,
      },
      {
        method: 'POST',
        path: '/users/{id}/unlock',
        options: guarded({ validate: validate({ params: ctrl.userIdParam }) }),
        handler: ctrl.unlockAccount,
      },
    ]);
  },
};
