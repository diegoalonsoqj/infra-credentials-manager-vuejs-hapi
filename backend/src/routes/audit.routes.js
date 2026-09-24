'use strict';

const repo = require('../repositories/audit.repository');
const { requireAnyPermission } = require('../plugins/rbac');
const { Joi, M, VALIDATION_OPTIONS, singleMessageFailAction, paginationQuery } = require('../validation');
const { AUDIT_ACTIONS, RESULT } = require('../config/constants');

const VALID_ACTIONS = Object.values(AUDIT_ACTIONS);
const VALID_RESULTS = Object.values(RESULT); // 'S', 'F'

// =============================================================================
// audit.routes.js — Endpoints de solo lectura para el log de auditoría.
// Prefijo /api/audit.
//
// REGLAS:
//   - NUNCA exponer endpoints de escritura, edición ni borrado.
//   - GET /  → MOD_AUDIT: log completo con filtros.
//              AUDIT_TEAM (líderes): los eventos sobre los tipos de recurso de
//              su equipo, los haga quien los haga, más los suyos propios.
//   - GET /my-activity → cualquier usuario autenticado, filtrado a su user_id.
//   - GET /actions     → lista de acciones distintas (para filtros de UI).
//
// Los filtros admiten cadena vacía porque el frontend envía el parámetro sin
// valor cuando el filtro está "sin seleccionar".
// =============================================================================

// Formato ISO 8601 básico (YYYY-MM-DD o YYYY-MM-DDTHH:mm:ssZ).
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/;

const dateFilter = Joi.string().pattern(ISO_DATE_RE).allow('')
  .messages(M('Formato de fecha inválido. Use ISO 8601 (ej: 2024-01-15).'));

const actionFilter = Joi.string().valid(...VALID_ACTIONS).allow('')
  .messages(M('action no es una acción de auditoría válida.'));

const resultFilter = Joi.string().valid(...VALID_RESULTS).allow('')
  .messages(M('result debe ser S o F.'));

// Se declaran todos los parámetros que envía el visor. Antes page, limit,
// resourceType e isPrdAccess pasaban sin validar por allowUnknown. page y limit
// se siguen acotando en el handler; aquí solo se exige que sean enteros.
const myActivityQuery = Joi.object({
  ...paginationQuery,
  dateFrom: dateFilter,
  dateTo:   dateFilter,
  action:   actionFilter,
  result:   resultFilter,
});

// Filtros exclusivos del log completo: /me ya está acotado al propio usuario.
const auditLogQuery = myActivityQuery.keys({
  username: Joi.string().max(100).allow('').messages({
    'string.base': 'username debe ser un valor único.',
    'string.max':  'username no puede superar 100 caracteres.',
    '*':           'username no es válido.',
  }),
  resourceType: Joi.string().valid('DB', 'OS', 'APP', 'NET', 'SYS').allow('')
    .messages(M('resourceType debe ser DB, OS, APP, NET o SYS.')),
  isPrdAccess: Joi.string().valid('true', 'false').allow('')
    .messages(M('isPrdAccess debe ser true o false.')),
});

// GET /my-activity (widget): solo el número de registros.
const recentActivityQuery = Joi.object({ limit: paginationQuery.limit });

const validate = (query) => ({
  query,
  options: VALIDATION_OPTIONS,
  failAction: singleMessageFailAction,
});

/** Normaliza un filtro opcional: la cadena vacía equivale a "sin filtro". */
const filter = (value) => (value === undefined || value === '' ? undefined : value);

const canReadAudit = requireAnyPermission('MOD_AUDIT', 'AUDIT_TEAM');

/**
 * Ámbito del log para quien llama. null = sin restricción (MOD_AUDIT). Con solo
 * AUDIT_TEAM: los tipos de recurso de su equipo y sus propios eventos. Sin
 * equipo, la lista de tipos queda vacía y solo ve lo suyo.
 */
function auditScope(user) {
  if ((user.permissions || []).includes('MOD_AUDIT')) return null;
  return { resourceTypes: user.teamResourceTypes || [], userId: user.id };
}

module.exports = {
  name: 'icm-routes-audit',
  register(server) {
    server.route([
      // -----------------------------------------------------------------
      // GET /api/audit/actions — Lista de acciones para dropdowns de filtro
      // -----------------------------------------------------------------
      {
        method: 'GET',
        path: '/actions',
        options: {
          auth: 'session',
          pre: [canReadAudit],
        },
        handler: async () => ({ success: true, actions: await repo.findDistinctActions() }),
      },

      // -----------------------------------------------------------------
      // GET /api/audit/my-activity — Actividad propia (widget Dashboard + página)
      // -----------------------------------------------------------------
      {
        method: 'GET',
        path: '/my-activity',
        options: { auth: 'session', validate: validate(recentActivityQuery) },
        handler: async (request) => {
          const limit = Math.max(1, Math.min((parseInt(request.query.limit, 10) || 10), 50));
          const records = await repo.findRecentByUser(request.auth.credentials.id, limit);
          return { success: true, records };
        },
      },

      // -----------------------------------------------------------------
      // GET /api/audit/me — Mi actividad paginada con filtros
      // -----------------------------------------------------------------
      {
        method: 'GET',
        path: '/me',
        options: {
          auth: 'session',
          validate: validate(myActivityQuery),
        },
        handler: async (request) => {
          const q     = request.query;
          const page  = Math.max(1, Math.min((parseInt(q.page,  10) || 1), 10000));
          const limit = Math.max(1, (parseInt(q.limit, 10) || 30));

          const result = await repo.findByUser(request.auth.credentials.id, {
            page,
            limit:    Math.min(limit, 100),
            action:   filter(q.action),
            result:   filter(q.result),
            dateFrom: filter(q.dateFrom),
            dateTo:   filter(q.dateTo),
          });
          return { success: true, ...result };
        },
      },

      // -----------------------------------------------------------------
      // GET /api/audit — Log completo (MOD_AUDIT) o de su equipo (AUDIT_TEAM)
      // -----------------------------------------------------------------
      {
        method: 'GET',
        path: '/',
        options: {
          auth: 'session',
          pre: [canReadAudit],
          validate: validate(auditLogQuery),
        },
        handler: async (request) => {
          const q     = request.query;
          const page  = Math.max(1, Math.min((parseInt(q.page,  10) || 1), 10000));
          const limit = Math.max(1, (parseInt(q.limit, 10) || 30));
          const scope = auditScope(request.auth.credentials);

          const result = await repo.findAll({
            scope,
            page,
            limit:        Math.min(limit, 100),
            username:     filter(q.username),
            action:       filter(q.action),
            resourceType: filter(q.resourceType),
            result:       filter(q.result),
            isPrdAccess:  filter(q.isPrdAccess),
            dateFrom:     filter(q.dateFrom),
            dateTo:       filter(q.dateTo),
          });
          // La pantalla lo usa para decir qué se está viendo.
          return { success: true, ...result, scope: scope ? { resourceTypes: scope.resourceTypes } : null };
        },
      },
    ]);
  },
};
