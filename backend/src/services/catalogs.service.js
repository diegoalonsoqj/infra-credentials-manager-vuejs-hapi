'use strict';

const repo   = require('../repositories/catalogs.repository');
const { query } = require('../config/database');
const { AUDIT_ACTIONS, RESULT, ROLE_LEVELS, PERMISSIONS } = require('../config/constants');
const logger = require('../utils/logger');
const custody = require('./custody');

class ValidationError extends Error {
  constructor(msg) { super(msg); this.name = 'ValidationError'; this.isValidation = true; }
}
class NotFoundError extends Error {
  constructor(msg) { super(msg); this.name = 'NotFoundError'; this.isNotFound = true; }
}
class ConflictError extends Error {
  constructor(msg) { super(msg); this.name = 'ConflictError'; this.isConflict = true; }
}
// El cambio dejaría credenciales custodiadas sin nadie capaz de descifrarlas.
// No se guarda nada; la petición puede repetirse con confirmCustodyImpact.
class CustodyImpactError extends Error {
  constructor(impact) {
    super(
      `Este cambio dejaría ${impact.length} credencial(es) custodiada(s) sin nadie que pueda ` +
      'descifrarlas hasta que un administrador las reasigne. Confirma para guardarlo igualmente.'
    );
    this.name = 'CustodyImpactError';
    this.isCustodyImpact = true;
    this.impact = impact;
  }
}

// Aviso de custodia: si quitar CRED_REVEAL a un rol o un tipo a un
// equipo deja credenciales custodiadas sin nadie capaz de abrirlas, se exige
// confirmación explícita. Se avisa en vez de impedirlo porque quitar el permiso
// puede ser justo lo que se quiere.
function requireCustodyConfirmation(impact, confirmed) {
  if (impact.length > 0 && !confirmed) throw new CustodyImpactError(impact);
}

// Rastro en la auditoría cuando se confirma un cambio con impacto de custodia.
function custodyImpactExtra(impact) {
  if (impact.length === 0) return undefined;
  return { custodyImpactConfirmed: impact.length, credentials: impact.map((c) => c.credential) };
}

// Mensaje de "en uso" que nombra los elementos, no solo cuántos son: con
// "existen 3 instancias asociadas" el administrador tenía que buscarlas a mano.
const USAGE_LABELS = {
  SERVER: 'servidor', DB_SERVICE: 'servicio de BD', APPLICATION: 'aplicación', PROJECT: 'proyecto',
};
const USAGE_MAX_LISTED = 5;

function usageMessage(subject, usages) {
  const listed = usages.slice(0, USAGE_MAX_LISTED)
    .map((u) => `${USAGE_LABELS[u.kind] || u.kind} ${u.code} (${u.name})`);
  const rest = usages.length - listed.length;
  return `No se puede eliminar: ${subject} está en uso por ${usages.length} elemento(s): ` +
    listed.join(', ') + (rest > 0 ? ` y ${rest} más` : '') + '.';
}

async function auditAction({ actorId, actorUsername, action, resourceId, resourceName, result, failReason, ipAddress, extra }) {
  try {
    await query(
      `INSERT INTO sch_audit.tbl_audit_log
         (user_id, username, action, resource_type, resource_id, resource_name,
          result, fail_reason, ip_address, extra_data)
       VALUES ($1,$2,$3,'SYS',$4,$5,$6,$7,$8,$9)`,
      [actorId, actorUsername, action,
       resourceId ? String(resourceId) : null,
       resourceName || null, result, failReason || null, ipAddress || null,
       JSON.stringify(extra || {})]
    );
  } catch (err) {
    logger.error('Error en auditoría de catálogos:', { code: err.code });
  }
}

// =============================================================================
// Ambientes
// =============================================================================

async function listEnvironments() {
  return repo.findAllEnvironments();
}

async function createEnvironment(data, actor) {
  const { code, name, description, prdFlag, sortOrder } = data;
  if (!code || !code.trim())  throw new ValidationError('El código es obligatorio.');
  if (!/^[A-Za-z0-9_-]+$/.test(code)) throw new ValidationError('Código: solo letras, números, guion y guion bajo.');
  if (!name || !name.trim()) throw new ValidationError('El nombre es obligatorio.');

  if (await repo.existsEnvironmentByCode(code)) {
    throw new ConflictError(`Ya existe un ambiente con el código "${code.toUpperCase()}".`);
  }

  const env = await repo.createEnvironment({ code, name, description, prdFlag, sortOrder });

  await auditAction({
    actorId: actor.id, actorUsername: actor.username,
    action: AUDIT_ACTIONS.CATALOG_UPDATE,
    resourceId: env.id, resourceName: `ENV:${env.code}`,
    result: RESULT.SUCCESS, ipAddress: actor.ip,
  });

  logger.info('Ambiente creado.', { code: env.code, by: actor.username });
  return env;
}

async function updateEnvironment(id, data, actor) {
  const { name, description, prdFlag, sortOrder } = data;
  if (!name || !name.trim()) throw new ValidationError('El nombre es obligatorio.');

  const existing = await repo.findEnvironmentById(id);
  if (!existing) throw new NotFoundError('Ambiente no encontrado.');

  const updated = await repo.updateEnvironment(id, { name, description, prdFlag, sortOrder });

  await auditAction({
    actorId: actor.id, actorUsername: actor.username,
    action: AUDIT_ACTIONS.CATALOG_UPDATE,
    resourceId: id, resourceName: `ENV:${existing.code}`,
    result: RESULT.SUCCESS, ipAddress: actor.ip,
  });

  logger.info('Ambiente actualizado.', { id, by: actor.username });
  return updated;
}

async function toggleEnvironmentEstado(id, actor) {
  const existing = await repo.findEnvironmentById(id);
  if (!existing) throw new NotFoundError('Ambiente no encontrado.');

  const updated = await repo.toggleEnvironmentEstado(id);

  await auditAction({
    actorId: actor.id, actorUsername: actor.username,
    action: AUDIT_ACTIONS.CATALOG_UPDATE,
    resourceId: id, resourceName: `ENV:${existing.code}`,
    result: RESULT.SUCCESS, ipAddress: actor.ip,
  });

  return updated;
}

async function deleteEnvironment(id, actor) {
  const existing = await repo.findEnvironmentById(id);
  if (!existing) throw new NotFoundError('Ambiente no encontrado.');

  const usages = await repo.findEnvironmentUsages(id);
  if (usages.length > 0) throw new ConflictError(usageMessage('el ambiente', usages));

  await repo.softDeleteEnvironment(id);

  await auditAction({
    actorId: actor.id, actorUsername: actor.username,
    action: AUDIT_ACTIONS.CATALOG_UPDATE,
    resourceId: id, resourceName: `ENV:${existing.code}`,
    result: RESULT.SUCCESS, ipAddress: actor.ip,
  });

  logger.info('Ambiente eliminado.', { id, code: existing.code, by: actor.username });
  return { success: true };
}

// =============================================================================
// Infraestructuras
// =============================================================================

async function listInfrastructures() {
  return repo.findAllInfrastructures();
}

async function createInfrastructure(data, actor) {
  const { code, name, description } = data;
  if (!code || !code.trim())  throw new ValidationError('El código es obligatorio.');
  if (!/^[A-Za-z0-9_-]+$/.test(code)) throw new ValidationError('Código: solo letras, números, guion y guion bajo.');
  if (!name || !name.trim()) throw new ValidationError('El nombre es obligatorio.');

  if (await repo.existsInfrastructureByCode(code)) {
    throw new ConflictError(`Ya existe una infraestructura con el código "${code.toUpperCase()}".`);
  }

  const infra = await repo.createInfrastructure({ code, name, description });

  await auditAction({
    actorId: actor.id, actorUsername: actor.username,
    action: AUDIT_ACTIONS.CATALOG_UPDATE,
    resourceId: infra.id, resourceName: `INFRA:${infra.code}`,
    result: RESULT.SUCCESS, ipAddress: actor.ip,
  });

  logger.info('Infraestructura creada.', { code: infra.code, by: actor.username });
  return infra;
}

async function updateInfrastructure(id, data, actor) {
  const { name, description } = data;
  if (!name || !name.trim()) throw new ValidationError('El nombre es obligatorio.');

  const existing = await repo.findInfrastructureById(id);
  if (!existing) throw new NotFoundError('Infraestructura no encontrada.');

  const updated = await repo.updateInfrastructure(id, { name, description });

  await auditAction({
    actorId: actor.id, actorUsername: actor.username,
    action: AUDIT_ACTIONS.CATALOG_UPDATE,
    resourceId: id, resourceName: `INFRA:${existing.code}`,
    result: RESULT.SUCCESS, ipAddress: actor.ip,
  });

  logger.info('Infraestructura actualizada.', { id, by: actor.username });
  return updated;
}

async function toggleInfrastructureEstado(id, actor) {
  const existing = await repo.findInfrastructureById(id);
  if (!existing) throw new NotFoundError('Infraestructura no encontrada.');

  const updated = await repo.toggleInfrastructureEstado(id);

  await auditAction({
    actorId: actor.id, actorUsername: actor.username,
    action: AUDIT_ACTIONS.CATALOG_UPDATE,
    resourceId: id, resourceName: `INFRA:${existing.code}`,
    result: RESULT.SUCCESS, ipAddress: actor.ip,
  });

  return updated;
}

async function deleteInfrastructure(id, actor) {
  const existing = await repo.findInfrastructureById(id);
  if (!existing) throw new NotFoundError('Infraestructura no encontrada.');

  const usages = await repo.findInfrastructureUsages(id);
  if (usages.length > 0) throw new ConflictError(usageMessage('la infraestructura', usages));

  await repo.softDeleteInfrastructure(id);

  await auditAction({
    actorId: actor.id, actorUsername: actor.username,
    action: AUDIT_ACTIONS.CATALOG_UPDATE,
    resourceId: id, resourceName: `INFRA:${existing.code}`,
    result: RESULT.SUCCESS, ipAddress: actor.ip,
  });

  logger.info('Infraestructura eliminada.', { id, code: existing.code, by: actor.username });
  return { success: true };
}

// =============================================================================
// Roles
// =============================================================================

async function listRoles() { return repo.findAllRoles(); }

async function createRole(data, actor) {
  const { code, name, level, description } = data;
  if (!code || !code.trim()) throw new ValidationError('El código es obligatorio.');
  if (!/^[A-Za-z0-9_-]+$/.test(code)) throw new ValidationError('Código: solo letras, números, guion y guion bajo.');
  if (!name || !name.trim()) throw new ValidationError('El nombre es obligatorio.');

  const levelNum = parseInt(level, 10);
  if (isNaN(levelNum) || levelNum < 0 || levelNum > 99) {
    throw new ValidationError('El nivel debe ser un entero entre 0 y 99 (los niveles >= 100 son exclusivos de ADMIN del sistema).');
  }

  if (await repo.existsRoleByCode(code)) {
    throw new ConflictError(`Ya existe un rol con el código "${code.toUpperCase()}".`);
  }

  const role = await repo.createRole({ code, name, level: levelNum, description });

  await auditAction({
    actorId: actor.id, actorUsername: actor.username,
    action: AUDIT_ACTIONS.CATALOG_UPDATE,
    resourceId: role.id, resourceName: `ROLE:${role.code}`,
    result: RESULT.SUCCESS, ipAddress: actor.ip,
  });

  logger.info('Rol creado.', { code: role.code, level: role.level, by: actor.username });
  return role;
}

async function updateRole(id, data, actor) {
  const { name, description } = data;
  if (!name || !name.trim()) throw new ValidationError('El nombre es obligatorio.');

  const existing = await repo.findRoleById(id);
  if (!existing) throw new NotFoundError('Rol no encontrado.');

  const updated = await repo.updateRole(id, { name, description });

  await auditAction({
    actorId: actor.id, actorUsername: actor.username,
    action: AUDIT_ACTIONS.CATALOG_UPDATE,
    resourceId: id, resourceName: `ROLE:${existing.code}`,
    result: RESULT.SUCCESS, ipAddress: actor.ip,
  });

  logger.info('Rol actualizado.', { id, by: actor.username });
  return updated;
}

async function toggleRoleEstado(id, actor) {
  const existing = await repo.findRoleById(id);
  if (!existing) throw new NotFoundError('Rol no encontrado.');
  if (existing.is_system) throw new ConflictError('Los roles del sistema no pueden desactivarse.');

  // Solo se comprueba al DESACTIVAR: el toggle es bidireccional y reactivar
  // un rol con usuarios debe seguir siendo posible.
  //
  // Motivo: desactivar un rol no revoca nada por si solo. Ni la consulta de login
  // (auth.repository.js) ni la del esquema de sesion (plugins/auth.js) filtran
  // por el estado del rol, asi que los usuarios asignados seguirian entrando con
  // todos sus permisos. Se niega la accion en lugar de dejar un control que
  // aparenta funcionar y no hace nada.
  if (existing.estado === 'AI') {
    const userCount = await repo.countUsersByRole(id);
    if (userCount > 0) {
      throw new ConflictError(
        `No se puede desactivar: ${userCount} usuario(s) tienen este rol asignado. ` +
        'Reasígnalos a otro rol primero.'
      );
    }
  }

  const updated = await repo.toggleRoleEstado(id);

  await auditAction({
    actorId: actor.id, actorUsername: actor.username,
    action: AUDIT_ACTIONS.CATALOG_UPDATE,
    resourceId: id, resourceName: `ROLE:${existing.code}`,
    result: RESULT.SUCCESS, ipAddress: actor.ip,
  });

  return updated;
}

async function deleteRole(id, actor) {
  const existing = await repo.findRoleById(id);
  if (!existing) throw new NotFoundError('Rol no encontrado.');
  if (existing.is_system) throw new ConflictError('Los roles del sistema no pueden eliminarse.');

  const userCount = await repo.countUsersByRole(id);
  if (userCount > 0) {
    throw new ConflictError(`No se puede eliminar: ${userCount} usuario(s) tienen este rol asignado.`);
  }

  await repo.softDeleteRole(id);

  await auditAction({
    actorId: actor.id, actorUsername: actor.username,
    action: AUDIT_ACTIONS.CATALOG_UPDATE,
    resourceId: id, resourceName: `ROLE:${existing.code}`,
    result: RESULT.SUCCESS, ipAddress: actor.ip,
  });

  logger.info('Rol eliminado.', { id, code: existing.code, by: actor.username });
  return { success: true };
}

// =============================================================================
// Equipos
// =============================================================================

async function listTeams() { return repo.findAllTeams(); }

const VALID_RESOURCE_TYPES = ['DB', 'OS', 'APP'];

function validateResourceTypes(resourceTypes) {
  if (!Array.isArray(resourceTypes) || resourceTypes.length === 0) {
    throw new ValidationError('Debe seleccionar al menos un tipo de recurso.');
  }
  const invalid = resourceTypes.filter((rt) => !VALID_RESOURCE_TYPES.includes(rt));
  if (invalid.length > 0) {
    throw new ValidationError(`Tipo(s) de recurso inválido(s): ${invalid.join(', ')}.`);
  }
  // Deduplicar
  return [...new Set(resourceTypes)];
}

async function createTeam(data, actor) {
  const { code, name, resourceTypes, description } = data;
  if (!code || !code.trim()) throw new ValidationError('El código es obligatorio.');
  if (!/^[A-Za-z0-9_-]+$/.test(code)) throw new ValidationError('Código: solo letras, números, guion y guion bajo.');
  if (!name || !name.trim()) throw new ValidationError('El nombre es obligatorio.');

  const cleanTypes = validateResourceTypes(resourceTypes);

  if (await repo.existsTeamByCode(code)) {
    throw new ConflictError(`Ya existe un equipo con el código "${code.toUpperCase()}".`);
  }

  const team = await repo.createTeam({ code, name, resourceTypes: cleanTypes, description });

  await auditAction({
    actorId: actor.id, actorUsername: actor.username,
    action: AUDIT_ACTIONS.CATALOG_UPDATE,
    resourceId: team.id, resourceName: `TEAM:${team.code}`,
    result: RESULT.SUCCESS, ipAddress: actor.ip,
  });

  logger.info('Equipo creado.', { code: team.code, resourceTypes: cleanTypes, by: actor.username });
  return team;
}

async function updateTeam(id, data, actor) {
  const { name, description, resourceTypes, confirmCustodyImpact } = data;
  if (!name || !name.trim()) throw new ValidationError('El nombre es obligatorio.');

  const existing = await repo.findTeamById(id);
  if (!existing) throw new NotFoundError('Equipo no encontrado.');

  const cleanTypes = validateResourceTypes(resourceTypes);

  // Quitar un tipo al equipo puede dejar sin descifrar las credenciales que
  // custodian sus miembros. Solo se calcula si de verdad se quita alguno.
  const removed = (existing.resource_types || []).filter((t) => !cleanTypes.includes(t));
  const impact = removed.length === 0 ? [] : await custody.credencialesQueQuedarianBloqueadas(
    { query }, { teamId: id }, (cap) => cap && { ...cap, resource_types: cleanTypes }
  );
  requireCustodyConfirmation(impact, confirmCustodyImpact);

  const updated = await repo.updateTeam(id, { name, description, resourceTypes: cleanTypes });

  await auditAction({
    actorId: actor.id, actorUsername: actor.username,
    action: AUDIT_ACTIONS.CATALOG_UPDATE,
    resourceId: id, resourceName: `TEAM:${existing.code}`,
    result: RESULT.SUCCESS, ipAddress: actor.ip,
    extra: custodyImpactExtra(impact),
  });

  logger.info('Equipo actualizado.', { id, resourceTypes: cleanTypes, by: actor.username });
  return updated;
}

async function toggleTeamEstado(id, actor) {
  const existing = await repo.findTeamById(id);
  if (!existing) throw new NotFoundError('Equipo no encontrado.');
  if (existing.is_system) throw new ConflictError('Los equipos del sistema no pueden desactivarse.');

  // Solo se comprueba al DESACTIVAR: el toggle es bidireccional y reactivar
  // un equipo con usuarios debe seguir siendo posible.
  //
  // Motivo: desactivar un equipo no revoca nada por si solo. Ni la consulta de login
  // (auth.repository.js) ni la del esquema de sesion (plugins/auth.js) filtran
  // por el estado del equipo, asi que los usuarios asignados seguirian entrando con
  // todos sus permisos. Se niega la accion en lugar de dejar un control que
  // aparenta funcionar y no hace nada.
  if (existing.estado === 'AI') {
    const userCount = await repo.countUsersByTeam(id);
    if (userCount > 0) {
      throw new ConflictError(
        `No se puede desactivar: ${userCount} usuario(s) pertenecen a este equipo. ` +
        'Muévelos a otro equipo primero.'
      );
    }
  }

  const updated = await repo.toggleTeamEstado(id);

  await auditAction({
    actorId: actor.id, actorUsername: actor.username,
    action: AUDIT_ACTIONS.CATALOG_UPDATE,
    resourceId: id, resourceName: `TEAM:${existing.code}`,
    result: RESULT.SUCCESS, ipAddress: actor.ip,
  });

  return updated;
}

async function deleteTeam(id, actor) {
  const existing = await repo.findTeamById(id);
  if (!existing) throw new NotFoundError('Equipo no encontrado.');
  if (existing.is_system) throw new ConflictError('Los equipos del sistema no pueden eliminarse.');

  const userCount = await repo.countUsersByTeam(id);
  if (userCount > 0) {
    throw new ConflictError(`No se puede eliminar: ${userCount} usuario(s) pertenecen a este equipo.`);
  }

  await repo.softDeleteTeam(id);

  await auditAction({
    actorId: actor.id, actorUsername: actor.username,
    action: AUDIT_ACTIONS.CATALOG_UPDATE,
    resourceId: id, resourceName: `TEAM:${existing.code}`,
    result: RESULT.SUCCESS, ipAddress: actor.ip,
  });

  logger.info('Equipo eliminado.', { id, code: existing.code, by: actor.username });
  return { success: true };
}

// =============================================================================
// Permisos
// =============================================================================

async function listPermissions() { return repo.findAllPermissions(); }

async function getPermissionsByRole(roleId) {
  const existing = await repo.findRoleById(roleId);
  if (!existing) throw new NotFoundError('Rol no encontrado.');
  return repo.findPermissionsByRoleId(roleId);
}

async function setRolePermissions(roleId, permissionIds, actor, { confirmCustodyImpact = false } = {}) {
  const existing = await repo.findRoleById(roleId);
  if (!existing) throw new NotFoundError('Rol no encontrado.');
  // Nota: los roles is_system SÍ pueden tener sus permisos editados.
  // El guard de is_system solo protege toggle-estado y delete.

  // Un id repetido violaba la clave primaria de tbl_role_permissions y la API
  // respondia 409 con un mensaje de "valor en uso" que no explicaba nada.
  const ids = [...new Set(permissionIds)];

  // Validar que todos los IDs existan
  const allPerms = await repo.findAllPermissions();
  const validIds = new Set(allPerms.map((p) => p.id));
  const invalid  = ids.filter((id) => !validIds.has(id));
  if (invalid.length > 0) {
    throw new ValidationError(`IDs de permiso inválidos: ${invalid.join(', ')}.`);
  }

  // MOD_CATALOGS es el permiso que exige esta misma ruta. Quitárselo a un rol
  // de nivel ADMIN hacía desaparecer la pantalla de permisos para todos los
  // administradores, y con ella cualquier forma de devolverlo —ni "Restaurar
  // por defecto" ni reset-admin-password.js tocan permisos—: solo quedaba SQL.
  // Los demás permisos de módulo (MOD_USERS, MOD_SYSTEM…) se pueden quitar y
  // volver a dar mientras este se conserve, así que basta con proteger este.
  if (existing.level >= ROLE_LEVELS.ADMIN) {
    const catalogos = allPerms.find((p) => p.code === PERMISSIONS.MOD_CATALOGS);
    if (catalogos && !ids.includes(catalogos.id)) {
      throw new ValidationError(
        `El rol ${existing.code} no puede perder ${PERMISSIONS.MOD_CATALOGS}: es el permiso que ` +
        'permite editar los permisos, y sin él ningún administrador podría devolverlo.'
      );
    }
  }

  // Quitar CRED_REVEAL al rol deja sin descifrar las credenciales que custodian
  // sus usuarios. Si el rol no lo tenía, ninguna se podía abrir y no hay impacto.
  const reveal = allPerms.find((p) => p.code === PERMISSIONS.CRED_REVEAL);
  const keepsReveal = !reveal || ids.includes(reveal.id);
  const impact = keepsReveal ? [] : await custody.credencialesQueQuedarianBloqueadas(
    { query }, { roleId }, (cap) => cap && { ...cap, can_reveal: false }
  );
  requireCustodyConfirmation(impact, confirmCustodyImpact);

  await repo.setRolePermissions(roleId, ids);

  await auditAction({
    actorId: actor.id, actorUsername: actor.username,
    action: AUDIT_ACTIONS.CATALOG_UPDATE,
    resourceId: roleId, resourceName: `ROLE_PERMISSIONS:${existing.code}`,
    result: RESULT.SUCCESS, ipAddress: actor.ip,
    extra: custodyImpactExtra(impact),
  });

  logger.info('Permisos de rol actualizados.', { roleId, code: existing.code, by: actor.username });
  return repo.findPermissionsByRoleId(roleId);
}

// =============================================================================
// Catálogos de recursos: OS, Producto servidor, Producto BD, Motor BD
// =============================================================================

function makeCatalogService(repoObj, label) {
  return {
    list:   ()         => repoObj.findAll(),
    get:    (id)       => repoObj.findById(id).then((r) => { if (!r) throw new NotFoundError(`${label} no encontrado.`); return r; }),
    create: async ({ name, sortOrder }, actor) => {
      if (!name) throw new ValidationError('El nombre es obligatorio.');
      const result = await repoObj.create({ name, sortOrder });
      await auditAction({ actorId: actor.id, actorUsername: actor.username, action: AUDIT_ACTIONS.CATALOG_UPDATE, resourceName: `${label}:${result.code}`, result: RESULT.SUCCESS, ipAddress: actor.ip });
      return result;
    },
    update: async (id, { name, sortOrder }, actor) => {
      const existing = await repoObj.findById(id);
      if (!existing) throw new NotFoundError(`${label} no encontrado.`);
      const result = await repoObj.update(id, { name, sortOrder });
      await auditAction({ actorId: actor.id, actorUsername: actor.username, action: AUDIT_ACTIONS.CATALOG_UPDATE, resourceName: `${label}:${existing.code}`, result: RESULT.SUCCESS, ipAddress: actor.ip });
      return result;
    },
    toggle: async (id, actor) => {
      const result = await repoObj.toggle(id);
      if (!result) throw new NotFoundError(`${label} no encontrado.`);
      await auditAction({ actorId: actor.id, actorUsername: actor.username, action: AUDIT_ACTIONS.CATALOG_UPDATE, resourceName: `${label}:${result.code}`, result: RESULT.SUCCESS, ipAddress: actor.ip });
      return result;
    },
    delete: async (id, actor) => {
      const existing = await repoObj.findById(id);
      if (!existing) throw new NotFoundError(`${label} no encontrado.`);

      // Guarda referencial, igual que deleteEnvironment, deleteRole, deleteTeam
      // y deleteProject. Estos cuatro catálogos eran los únicos sin ella: se
      // podía borrar el SO "Linux" con servidores apuntando a él. La fila queda
      // con estado_registro = 'X', el desplegable del formulario deja de
      // ofrecerla —findAllOsTypes filtra borrados— pero el LEFT JOIN del
      // listado no filtra y el servidor sigue mostrando "Linux". Al editarlo,
      // el campo aparece sin selección y se pierde el dato al guardar.
      //
      // Solo se guarda el borrado, no la desactivación: desactivar una entrada
      // es precisamente la forma de retirarla de los desplegables sin tocar los
      // registros que ya la usan, y ahí no hay nada que romper.
      const enUso = await repoObj.countUsages(id);
      if (enUso > 0) {
        throw new ConflictError(
          `No se puede eliminar: ${enUso} ${repoObj.usageLabel} usan este registro. ` +
          'Desactívalo si solo quieres retirarlo de los formularios.'
        );
      }

      await repoObj.softDelete(id);
      await auditAction({ actorId: actor.id, actorUsername: actor.username, action: AUDIT_ACTIONS.CATALOG_UPDATE, resourceName: `${label}:${existing.code}`, result: RESULT.SUCCESS, ipAddress: actor.ip });
      return { success: true };
    },
  };
}

const osSvc            = makeCatalogService(repo.osRepo,            'OS');
const serverProductSvc = makeCatalogService(repo.serverProductRepo, 'ServerProduct');
const dbProductSvc     = makeCatalogService(repo.dbProductRepo,     'DbProduct');
const dbEngineSvc      = makeCatalogService(repo.dbEngineRepo,      'DbEngine');

// =============================================================================
// Proyectos
// =============================================================================

async function listProjects(infrastructureId = null) {
  return repo.findAllProjects(infrastructureId ? parseInt(infrastructureId, 10) : null);
}

async function createProject(data, actor) {
  const { name, infrastructureId, sortOrder } = data;
  if (!name || !name.trim()) throw new ValidationError('El nombre es obligatorio.');

  const project = await repo.createProject({ name, infrastructureId, sortOrder });

  await auditAction({
    actorId: actor.id, actorUsername: actor.username,
    action: AUDIT_ACTIONS.CATALOG_UPDATE,
    resourceId: project.id, resourceName: `PRJ:${project.code}`,
    result: RESULT.SUCCESS, ipAddress: actor.ip,
  });

  logger.info('Proyecto creado.', { code: project.code, by: actor.username });
  return project;
}

async function updateProject(id, data, actor) {
  const { name, infrastructureId, sortOrder } = data;
  if (!name || !name.trim()) throw new ValidationError('El nombre es obligatorio.');

  const existing = await repo.findProjectById(id);
  if (!existing) throw new NotFoundError('Proyecto no encontrado.');

  const updated = await repo.updateProject(id, { name, infrastructureId, sortOrder });

  await auditAction({
    actorId: actor.id, actorUsername: actor.username,
    action: AUDIT_ACTIONS.CATALOG_UPDATE,
    resourceId: id, resourceName: `PRJ:${existing.code}`,
    result: RESULT.SUCCESS, ipAddress: actor.ip,
  });

  logger.info('Proyecto actualizado.', { id, by: actor.username });
  return updated;
}

async function toggleProjectEstado(id, actor) {
  const existing = await repo.findProjectById(id);
  if (!existing) throw new NotFoundError('Proyecto no encontrado.');

  const updated = await repo.toggleProjectEstado(id);

  await auditAction({
    actorId: actor.id, actorUsername: actor.username,
    action: AUDIT_ACTIONS.CATALOG_UPDATE,
    resourceId: id, resourceName: `PRJ:${existing.code}`,
    result: RESULT.SUCCESS, ipAddress: actor.ip,
  });

  return updated;
}

async function deleteProject(id, actor) {
  const existing = await repo.findProjectById(id);
  if (!existing) throw new NotFoundError('Proyecto no encontrado.');

  const usages = await repo.findProjectUsages(id);
  if (usages.length > 0) throw new ConflictError(usageMessage('el proyecto', usages));

  await repo.softDeleteProject(id);

  await auditAction({
    actorId: actor.id, actorUsername: actor.username,
    action: AUDIT_ACTIONS.CATALOG_UPDATE,
    resourceId: id, resourceName: `PRJ:${existing.code}`,
    result: RESULT.SUCCESS, ipAddress: actor.ip,
  });

  logger.info('Proyecto eliminado.', { id, code: existing.code, by: actor.username });
  return { success: true };
}

// Usos de un catálogo, para que la ventana de eliminar avise antes de confirmar.
function usagesGetter(findById, findUsages, notFound) {
  return async (id) => {
    if (!(await findById(id))) throw new NotFoundError(notFound);
    return findUsages(id);
  };
}
const getEnvironmentUsages    = usagesGetter(repo.findEnvironmentById, repo.findEnvironmentUsages, 'Ambiente no encontrado.');
const getInfrastructureUsages = usagesGetter(repo.findInfrastructureById, repo.findInfrastructureUsages, 'Infraestructura no encontrada.');
const getProjectUsages        = usagesGetter(repo.findProjectById, repo.findProjectUsages, 'Proyecto no encontrado.');

module.exports = {
  getEnvironmentUsages, getInfrastructureUsages, getProjectUsages, usageMessage,
  listEnvironments, createEnvironment, updateEnvironment, toggleEnvironmentEstado, deleteEnvironment,
  listInfrastructures, createInfrastructure, updateInfrastructure, toggleInfrastructureEstado, deleteInfrastructure,
  listRoles, createRole, updateRole, toggleRoleEstado, deleteRole,
  listTeams, createTeam, updateTeam, toggleTeamEstado, deleteTeam,
  listPermissions, getPermissionsByRole, setRolePermissions,
  osSvc, serverProductSvc, dbProductSvc, dbEngineSvc,
  listProjects, createProject, updateProject, toggleProjectEstado, deleteProject,
  ValidationError, NotFoundError, ConflictError, CustodyImpactError,
};
