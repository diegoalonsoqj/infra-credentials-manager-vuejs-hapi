'use strict';

const svc = require('../services/catalogs.service');
const { requirePermission, requireMinLevel } = require('../plugins/rbac');
const { ROLE_LEVELS } = require('../config/constants');
const { clientIp } = require('../utils/clientIp');
const {
  Joi, M, VALIDATION_OPTIONS, failAction, singleMessageFailAction, intIdParam,
} = require('../validation');

// =============================================================================
// catalogs.routes.js — Catálogos del sistema. Prefijo /api/catalogs.
//
// Todos los endpoints requieren el permiso MOD_CATALOGS y nivel ADMIN.
//
// El nivel se exige además del permiso —igual que en security.routes.js y
// system.routes.js— porque MOD_CATALOGS da acceso a
// PUT /roles/{id}/permissions, es decir, a concederse a uno mismo cualquier
// permiso del sistema. Sin la comprobación de nivel, conceder MOD_CATALOGS a un
// rol intermedio lo convertía de hecho en administrador.
//
// GET /projects estaba exento "porque lo consumen los formularios de recursos",
// pero eso no era cierto: el frontend obtiene los proyectos de
// /api/resources/catalogs y los filtra en cliente. Era el único catálogo sin
// guard, así que se alinea con el resto.
// =============================================================================

const adminOnly = [
  requirePermission('MOD_CATALOGS'),
  requireMinLevel(ROLE_LEVELS.ADMIN),
];

function buildActor(request) {
  const user = request.auth.credentials;
  return { id: user.id, username: user.username, ip: clientIp(request) };
}

/**
 * Traduce los errores de negocio del servicio a respuestas HTTP.
 * Cualquier otro error se propaga al manejador global (plugins/errors.js).
 */
function handleServiceError(err, h) {
  if (err.isValidation) return h.response({ success: false, code: 'VALIDATION_ERROR', message: err.message }).code(400);
  if (err.isNotFound)   return h.response({ success: false, code: 'NOT_FOUND',        message: err.message }).code(404);
  if (err.isConflict)   return h.response({ success: false, code: 'CONFLICT',         message: err.message }).code(409);
  // Además del mensaje, la lista de credenciales para la ventana de confirmación.
  if (err.isCustodyImpact) {
    return h.response({ success: false, code: 'CUSTODY_IMPACT', message: err.message, impact: err.impact }).code(409);
  }
  throw err;
}

/** Ejecuta el servicio y traduce sus errores de negocio. */
async function run(h, fn) {
  try {
    return await fn();
  } catch (err) { return handleServiceError(err, h); }
}

// Validación con la lista completa de errores ({ errors: [...] }).
const validate = (parts) => ({ ...parts, options: VALIDATION_OPTIONS, failAction });

// Validación con un único mensaje ({ message }), para los endpoints cuyos
// chequeos manuales devolvían ese formato (sortOrder, permissionIds).
const validateMsg = (parts) => ({ ...parts, options: VALIDATION_OPTIONS, failAction: singleMessageFailAction });

const withIntId = validate({ params: intIdParam });

// ---------------------------------------------------------------------------
// Esquemas de cuerpo
// ---------------------------------------------------------------------------
const codeField = Joi.string().trim().pattern(/^[A-Za-z0-9_-]+$/).required()
  .messages(M('Código inválido.'));

const nameField = (max) => Joi.string().trim().min(1).max(max).required()
  .messages(M('Nombre requerido.'));

const descriptionField = Joi.string().max(500).allow('', null).optional()
  .messages(M('La descripción no puede superar 500 caracteres.'));

const resourceTypesField = Joi.array()
  .items(Joi.string().valid('DB', 'OS', 'APP', 'NET').messages(M('Cada tipo de recurso debe ser DB, OS, APP o NET.')))
  .min(1).required()
  .messages(M('Debe indicar al menos un tipo de recurso.'));

// Campo que el formulario de edición reenvía pero que no se puede cambiar: el
// código de un registro, el nivel de un rol. Se declara para que el esquema
// estricto no rechace el formulario entero, y se descarta antes de llegar al
// servicio, que tampoco lo leía.
const immutableField = Joi.any().strip();

const sortOrderField = Joi.number().integer().min(0).optional()
  .messages(M('sortOrder debe ser un entero no negativo.'));

// description tiene que estar declarado aquí y en infraestructuras: el servicio
// lo guarda, y sin declararlo llegaría a la base sin validar.
const environmentSchema = Joi.object({
  code: codeField,
  name: nameField(50),
  description: descriptionField,
  prdFlag:   Joi.boolean().optional().messages(M('prdFlag debe ser booleano.')),
  sortOrder: sortOrderField,
});

// El PUT de ambientes, infraestructuras y roles no validaba el cuerpo en
// absoluto: solo el {id}. Estos esquemas lo cubren.
const environmentUpdateSchema = environmentSchema.keys({ code: immutableField });

const infrastructureSchema = Joi.object({
  code: codeField,
  name: nameField(100),
  description: descriptionField,
});

const infrastructureUpdateSchema = infrastructureSchema.keys({ code: immutableField });

const roleSchema = Joi.object({
  code: codeField,
  name: nameField(100),
  level: Joi.number().integer().min(0).max(99).required()
    .messages(M('Nivel debe ser entero entre 0 y 99.')),
  description: descriptionField,
});

// El nivel no se edita: updateRole solo cambia nombre y descripción.
const roleUpdateSchema = roleSchema.keys({ code: immutableField, level: immutableField });

const teamSchema = Joi.object({
  code: codeField,
  name: nameField(100),
  resourceTypes: resourceTypesField,
  description: descriptionField,
});

// Confirmación explícita de que el cambio puede dejar credenciales custodiadas
// sin nadie capaz de descifrarlas (requireCustodyConfirmation en catalogs.service).
const confirmCustodyImpactField = Joi.boolean().optional()
  .messages(M('confirmCustodyImpact debe ser true o false.'));

const teamUpdateSchema = Joi.object({
  code: immutableField,
  name: nameField(100),
  resourceTypes: resourceTypesField,
  description: descriptionField,
  confirmCustodyImpact: confirmCustodyImpactField,
});

const permissionIdsSchema = Joi.object({
  permissionIds: Joi.array().items(Joi.number().integer().min(1)).max(500).required()
    .messages(M('permissionIds debe ser un array de IDs de permiso.')),
  confirmCustodyImpact: confirmCustodyImpactField,
});

// Catálogos simples (sistemas operativos, productos, motores): nombre y orden.
// Antes solo se declaraba sortOrder y el nombre llegaba sin validar.
const simpleCatalogSchema = Joi.object({
  name: nameField(100),
  sortOrder: sortOrderField,
});

// Proyectos: nombre, infraestructura y orden. Mismo caso que los simples.
const projectSchema = Joi.object({
  name: nameField(200),
  infrastructureId: Joi.number().integer().min(1).allow('', null).optional()
    .messages(M('La infraestructura no es válida.')),
  sortOrder: sortOrderField,
});

// El filtro de proyectos exige un entero positivo en notación canónica
// (sin ceros a la izquierda ni espacios), igual que la comprobación anterior.
const projectsQuerySchema = Joi.object({
  infrastructureId: Joi.string().pattern(/^[1-9]\d*$/).allow('')
    .messages(M('infrastructureId debe ser un entero positivo.')),
});

/**
 * Rutas CRUD de un catálogo simple (solo nombre y orden).
 * Patrón uniforme: GET / POST / PUT /{id} / PATCH /{id}/toggle-estado / DELETE /{id}
 */
function simpleCatalogRoutes(prefix, svcObj) {
  const body = (request) => ({
    name: request.payload.name,
    sortOrder: request.payload.sortOrder,
  });

  return [
    {
      method: 'GET',
      path: `/${prefix}`,
      options: { auth: 'session', pre: adminOnly },
      handler: async () => ({ success: true, items: await svcObj.list() }),
    },
    {
      method: 'POST',
      path: `/${prefix}`,
      options: { auth: 'session', pre: adminOnly, validate: validateMsg({ payload: simpleCatalogSchema }) },
      handler: (request, h) => run(h, async () =>
        h.response({ success: true, item: await svcObj.create(body(request), buildActor(request)) }).code(201)),
    },
    {
      method: 'PUT',
      path: `/${prefix}/{id}`,
      options: {
        auth: 'session',
        pre: adminOnly,
        validate: validateMsg({ params: intIdParam, payload: simpleCatalogSchema }),
      },
      handler: (request, h) => run(h, async () =>
        ({ success: true, item: await svcObj.update(request.params.id, body(request), buildActor(request)) })),
    },
    {
      method: 'PATCH',
      path: `/${prefix}/{id}/toggle-estado`,
      options: { auth: 'session', pre: adminOnly, validate: withIntId },
      handler: (request, h) => run(h, async () =>
        ({ success: true, item: await svcObj.toggle(request.params.id, buildActor(request)) })),
    },
    {
      method: 'DELETE',
      path: `/${prefix}/{id}`,
      options: { auth: 'session', pre: adminOnly, validate: withIntId },
      handler: (request, h) => run(h, async () => {
        await svcObj.delete(request.params.id, buildActor(request));
        return { success: true };
      }),
    },
  ];
}

/**
 * GET de usos de un catálogo: { usages: [{ kind, code, name }] }. La ventana de
 * eliminar lo consulta al abrirse para avisar y no ofrecer un borrado que el
 * backend va a rechazar.
 */
function usagesRoute(path, getUsages) {
  return {
    method: 'GET',
    path,
    options: { auth: 'session', pre: adminOnly, validate: withIntId },
    handler: (request, h) => run(h, async () => ({ success: true, usages: await getUsages(request.params.id) })),
  };
}

/**
 * Rutas CRUD de un catálogo con code/name (ambientes, infraestructuras, roles).
 *
 * `updateSchema` valida el cuerpo del PUT. Antes el PUT solo validaba el {id}, y
 * el nombre y la descripción llegaban al servicio sin mirar.
 */
function namedCatalogRoutes({ prefix, key, schema, updateSchema, list, create, update, toggle, remove, usages }) {
  return [
    // GET /{id}/usages — qué elementos lo usan, para avisar antes de eliminar.
    ...(usages ? [usagesRoute(`/${prefix}/{id}/usages`, usages)] : []),
    {
      method: 'GET',
      path: `/${prefix}`,
      options: { auth: 'session', pre: adminOnly },
      handler: async () => ({ success: true, [`${prefix}`]: await list() }),
    },
    {
      method: 'POST',
      path: `/${prefix}`,
      options: { auth: 'session', pre: adminOnly, validate: validate({ payload: schema }) },
      handler: (request, h) => run(h, async () =>
        h.response({ success: true, [key]: await create(request.payload, buildActor(request)) }).code(201)),
    },
    {
      method: 'PUT',
      path: `/${prefix}/{id}`,
      options: {
        auth: 'session',
        pre: adminOnly,
        validate: validate({ params: intIdParam, payload: updateSchema }),
      },
      handler: (request, h) => run(h, async () =>
        ({ success: true, [key]: await update(request.params.id, request.payload, buildActor(request)) })),
    },
    {
      method: 'PATCH',
      path: `/${prefix}/{id}/toggle-estado`,
      options: { auth: 'session', pre: adminOnly, validate: withIntId },
      handler: (request, h) => run(h, async () =>
        ({ success: true, [key]: await toggle(request.params.id, buildActor(request)) })),
    },
    {
      method: 'DELETE',
      path: `/${prefix}/{id}`,
      options: { auth: 'session', pre: adminOnly, validate: withIntId },
      handler: (request, h) => run(h, async () => {
        await remove(request.params.id, buildActor(request));
        return { success: true };
      }),
    },
  ];
}

module.exports = {
  name: 'icm-routes-catalogs',
  register(server) {
    server.route([
      // -----------------------------------------------------------------
      // GET /api/catalogs — Todos los catálogos en una llamada (formularios)
      // -----------------------------------------------------------------
      {
        method: 'GET',
        path: '/',
        options: { auth: 'session', pre: adminOnly },
        handler: async () => {
          const [environments, infrastructures, teams, roles, permissions, projects] = await Promise.all([
            svc.listEnvironments(),
            svc.listInfrastructures(),
            svc.listTeams(),
            svc.listRoles(),
            svc.listPermissions(),
            svc.listProjects(),
          ]);
          return { success: true, environments, infrastructures, teams, roles, permissions, projects };
        },
      },

      // Ambientes
      ...namedCatalogRoutes({
        prefix: 'environments', key: 'environment',
        schema: environmentSchema, updateSchema: environmentUpdateSchema,
        list:   svc.listEnvironments,
        create: svc.createEnvironment,
        update: svc.updateEnvironment,
        toggle: svc.toggleEnvironmentEstado,
        remove: svc.deleteEnvironment,
        usages: svc.getEnvironmentUsages,
      }),

      // Infraestructuras
      ...namedCatalogRoutes({
        prefix: 'infrastructures', key: 'infrastructure',
        schema: infrastructureSchema, updateSchema: infrastructureUpdateSchema,
        list:   svc.listInfrastructures,
        create: svc.createInfrastructure,
        update: svc.updateInfrastructure,
        toggle: svc.toggleInfrastructureEstado,
        remove: svc.deleteInfrastructure,
        usages: svc.getInfrastructureUsages,
      }),

      // Roles — CRUD completo
      ...namedCatalogRoutes({
        prefix: 'roles', key: 'role',
        schema: roleSchema, updateSchema: roleUpdateSchema,
        list:   svc.listRoles,
        create: svc.createRole,
        update: svc.updateRole,
        toggle: svc.toggleRoleEstado,
        remove: svc.deleteRole,
      }),

      // ---------------------------------------------------------------------
      // Equipos — CRUD completo (el PUT sí valida el cuerpo)
      // ---------------------------------------------------------------------
      {
        method: 'GET',
        path: '/teams',
        options: { auth: 'session', pre: adminOnly },
        handler: async () => ({ success: true, teams: await svc.listTeams() }),
      },
      {
        method: 'POST',
        path: '/teams',
        options: { auth: 'session', pre: adminOnly, validate: validate({ payload: teamSchema }) },
        handler: (request, h) => run(h, async () =>
          h.response({ success: true, team: await svc.createTeam(request.payload, buildActor(request)) }).code(201)),
      },
      {
        method: 'PUT',
        path: '/teams/{id}',
        options: {
          auth: 'session',
          pre: adminOnly,
          validate: validate({ params: intIdParam, payload: teamUpdateSchema }),
        },
        handler: (request, h) => run(h, async () =>
          ({ success: true, team: await svc.updateTeam(request.params.id, request.payload, buildActor(request)) })),
      },
      {
        method: 'PATCH',
        path: '/teams/{id}/toggle-estado',
        options: { auth: 'session', pre: adminOnly, validate: withIntId },
        handler: (request, h) => run(h, async () =>
          ({ success: true, team: await svc.toggleTeamEstado(request.params.id, buildActor(request)) })),
      },
      {
        method: 'DELETE',
        path: '/teams/{id}',
        options: { auth: 'session', pre: adminOnly, validate: withIntId },
        handler: (request, h) => run(h, async () => {
          await svc.deleteTeam(request.params.id, buildActor(request));
          return { success: true };
        }),
      },

      // ---------------------------------------------------------------------
      // Permisos — catálogo + asignación por rol
      // ---------------------------------------------------------------------
      {
        method: 'GET',
        path: '/permissions',
        options: { auth: 'session', pre: adminOnly },
        handler: async () => ({ success: true, permissions: await svc.listPermissions() }),
      },
      {
        method: 'GET',
        path: '/roles/{id}/permissions',
        options: { auth: 'session', pre: adminOnly, validate: withIntId },
        handler: (request, h) => run(h, async () =>
          ({ success: true, permissions: await svc.getPermissionsByRole(request.params.id) })),
      },
      // PUT reemplaza TODOS los permisos del rol en una sola llamada (array de IDs)
      {
        method: 'PUT',
        path: '/roles/{id}/permissions',
        options: {
          auth: 'session',
          pre: adminOnly,
          validate: validateMsg({ params: intIdParam, payload: permissionIdsSchema }),
        },
        handler: (request, h) => run(h, async () => {
          const permissions = await svc.setRolePermissions(
            request.params.id, request.payload.permissionIds, buildActor(request),
            { confirmCustodyImpact: request.payload.confirmCustodyImpact }
          );
          return { success: true, permissions };
        }),
      },

      // ---------------------------------------------------------------------
      // Catálogos de recursos — OS, Producto servidor, Producto BD, Motor BD
      // ---------------------------------------------------------------------
      ...simpleCatalogRoutes('cat-os',              svc.osSvc),
      ...simpleCatalogRoutes('cat-server-products', svc.serverProductSvc),
      ...simpleCatalogRoutes('cat-db-products',     svc.dbProductSvc),
      ...simpleCatalogRoutes('cat-db-engines',      svc.dbEngineSvc),
      ...simpleCatalogRoutes('cat-network-products', svc.networkProductSvc),

      // ---------------------------------------------------------------------
      // Proyectos — catálogo vinculado a infraestructura
      // GET acepta ?infrastructureId= para filtrar por proveedor
      // ---------------------------------------------------------------------
      {
        method: 'GET',
        path: '/projects',
        options: {
          auth: 'session',
          pre: adminOnly,
          validate: validateMsg({ query: projectsQuerySchema }),
        },
        handler: async (request) => {
          const raw = request.query.infrastructureId;
          const infrastructureId = raw ? parseInt(raw, 10) : null;
          return { success: true, projects: await svc.listProjects(infrastructureId) };
        },
      },
      {
        method: 'POST',
        path: '/projects',
        options: { auth: 'session', pre: adminOnly, validate: validateMsg({ payload: projectSchema }) },
        handler: (request, h) => run(h, async () => {
          const { name, infrastructureId, sortOrder } = request.payload;
          const project = await svc.createProject({ name, infrastructureId, sortOrder }, buildActor(request));
          return h.response({ success: true, project }).code(201);
        }),
      },
      {
        method: 'PUT',
        path: '/projects/{id}',
        options: {
          auth: 'session',
          pre: adminOnly,
          validate: validateMsg({ params: intIdParam, payload: projectSchema }),
        },
        handler: (request, h) => run(h, async () => {
          const { name, infrastructureId, sortOrder } = request.payload;
          const project = await svc.updateProject(
            request.params.id, { name, infrastructureId, sortOrder }, buildActor(request)
          );
          return { success: true, project };
        }),
      },
      usagesRoute('/projects/{id}/usages', svc.getProjectUsages),
      {
        method: 'PATCH',
        path: '/projects/{id}/toggle-estado',
        options: { auth: 'session', pre: adminOnly, validate: withIntId },
        handler: (request, h) => run(h, async () =>
          ({ success: true, project: await svc.toggleProjectEstado(request.params.id, buildActor(request)) })),
      },
      {
        method: 'DELETE',
        path: '/projects/{id}',
        options: { auth: 'session', pre: adminOnly, validate: withIntId },
        handler: (request, h) => run(h, async () => {
          await svc.deleteProject(request.params.id, buildActor(request));
          return { success: true };
        }),
      },
    ]);
  },
};
