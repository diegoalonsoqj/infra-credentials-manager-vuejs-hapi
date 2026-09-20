'use strict';

const repo      = require('../repositories/resources.repository');
const { query } = require('../config/database');
const { AUDIT_ACTIONS, RESULT } = require('../config/constants');
const logger    = require('../utils/logger');

// =============================================================================
// resources.service.js — Lógica de negocio para servidores y servicios de BD.
// Modelo plano: un registro = un recurso en un ambiente específico.
//
// Reglas de negocio:
//   - El code es único e inmutable (no editable tras la creación).
//   - No se puede eliminar un recurso que tenga credenciales activas.
//   - resource_type auditado: 'OS' para servidores, 'DB' para servicios de BD.
// =============================================================================

class ValidationError extends Error {
  constructor(msg) { super(msg); this.name = 'ValidationError'; this.isValidation = true; }
}
class NotFoundError extends Error {
  constructor(msg) { super(msg); this.name = 'NotFoundError'; this.isNotFound = true; }
}

async function audit({ actorId, actorUsername, action, resourceType, resourceId, resourceName, result, ipAddress, extra }) {
  try {
    await query(
      `INSERT INTO sch_audit.tbl_audit_log
         (user_id, username, action, resource_type, resource_id, resource_name,
          result, ip_address, extra_data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [actorId, actorUsername, action, resourceType,
       resourceId ? String(resourceId) : null, resourceName || null,
       result, ipAddress || null, JSON.stringify(extra || {})]
    );
  } catch (err) {
    logger.error('Error auditoría recursos:', { code: err.code });
  }
}

// ---------------------------------------------------------------------------
// Catálogos
// ---------------------------------------------------------------------------

async function getCatalogs() {
  const [environments, infrastructures, osTypes, serverProducts, dbProducts, dbEngines, projects, servers] =
    await Promise.all([
      repo.findAllEnvironments(),
      repo.findAllInfrastructures(),
      repo.findAllOsTypes(),
      repo.findAllServerProducts(),
      repo.findAllDbProducts(),
      repo.findAllDbEngines(),
      repo.findAllProjects(),
      repo.findServersForSelect(),
    ]);
  return { environments, infrastructures, osTypes, serverProducts, dbProducts, dbEngines, projects, servers };
}

// ---------------------------------------------------------------------------
// Servidores
// ---------------------------------------------------------------------------

async function listServers({ page, limit, search, environmentId, infrastructureId, productId, osId } = {}) {
  return repo.findAllServers({ page, limit, search, environmentId, infrastructureId, productId, osId });
}

async function getServer(id) {
  const server = await repo.findServerById(id);
  if (!server) throw new NotFoundError('Servidor no encontrado');
  return server;
}

async function createServer(data, actor) {
  const { hostname, name } = data;

  if (!hostname || hostname.trim().length < 2)
    throw new ValidationError('El hostname es obligatorio');
  if (!name || name.trim().length < 2)
    throw new ValidationError('El nombre es obligatorio');
  if (!data.environmentId)
    throw new ValidationError('El ambiente es obligatorio');

  const server = await repo.createServer({ ...data, createdBy: actor.id });

  await audit({
    actorId: actor.id, actorUsername: actor.username,
    action: AUDIT_ACTIONS.RESOURCE_OS_CREATE,
    resourceType: 'OS', resourceId: server.id, resourceName: server.code,
    result: RESULT.SUCCESS, ipAddress: actor.ip,
  });

  return server;
}

async function updateServer(id, data, actor) {
  const existing = await repo.findServerById(id);
  if (!existing) throw new NotFoundError('Servidor no encontrado');

  if (!data.hostname || data.hostname.trim().length < 2)
    throw new ValidationError('El hostname es obligatorio');
  if (!data.name || data.name.trim().length < 2)
    throw new ValidationError('El nombre es obligatorio');
  if (!data.environmentId)
    throw new ValidationError('El ambiente es obligatorio');

  const updated = await repo.updateServer(id, data);
  if (!updated) throw new NotFoundError('Servidor no encontrado');

  await audit({
    actorId: actor.id, actorUsername: actor.username,
    action: AUDIT_ACTIONS.RESOURCE_OS_UPDATE,
    resourceType: 'OS', resourceId: id, resourceName: existing.code,
    result: RESULT.SUCCESS, ipAddress: actor.ip,
  });

  return updated;
}

async function toggleServerEstado(id, actor) {
  const existing = await repo.findServerById(id);
  if (!existing) throw new NotFoundError('Servidor no encontrado');

  // Solo se comprueba al DESACTIVAR: el toggle es bidireccional y reactivar debe
  // seguir siendo posible siempre.
  //
  // Motivo: desactivar un servidor no cortaba nada. El descifrado filtra por el estado
  // de la CREDENCIAL, nunca por el del recurso que la contiene, asi que sus
  // contrasenas se seguian listando y descifrando igual. Quien da de baja un servidor
  // y lo desactiva cree razonablemente que ha cerrado ese acceso. Se niega la
  // accion, igual que ya hacia el borrado, en vez de dejar un control que
  // aparenta funcionar.
  if (existing.estado === 'AI') {
    const creds = await repo.countCredentialsByServer(id);
    if (creds > 0) {
      throw new ValidationError(
        `No se puede desactivar: el servidor tiene ${creds} credencial(es) activa(s). ` +
        'Eliminalas o muevelas antes de darlo de baja.'
      );
    }
  }

  const updated = await repo.toggleServerEstado(id);
  if (!updated) throw new NotFoundError('Servidor no encontrado');

  await audit({
    actorId: actor.id, actorUsername: actor.username,
    action: AUDIT_ACTIONS.RESOURCE_OS_UPDATE,
    resourceType: 'OS', resourceId: id, resourceName: updated.code,
    result: RESULT.SUCCESS, ipAddress: actor.ip,
    extra: { estado: updated.estado },
  });

  return updated;
}

async function deleteServer(id, actor) {
  const existing = await repo.findServerById(id);
  if (!existing) throw new NotFoundError('Servidor no encontrado');

  const creds = await repo.countCredentialsByServer(id);
  if (creds > 0)
    throw new ValidationError(`No se puede eliminar: el servidor tiene ${creds} credencial(es) activa(s)`);

  const deleted = await repo.softDeleteServer(id);

  await audit({
    actorId: actor.id, actorUsername: actor.username,
    action: AUDIT_ACTIONS.RESOURCE_OS_DELETE,
    resourceType: 'OS', resourceId: id, resourceName: existing.code,
    result: RESULT.SUCCESS, ipAddress: actor.ip,
  });

  return deleted;
}

// ---------------------------------------------------------------------------
// Servicios de BD
// ---------------------------------------------------------------------------

async function listDbServices({ page, limit, search, environmentId, engineId, estado, productId, infrastructureId } = {}) {
  return repo.findAllDbServices({ page, limit, search, environmentId, engineId, estado, productId, infrastructureId });
}

async function getDbService(id) {
  const svc = await repo.findDbServiceById(id);
  if (!svc) throw new NotFoundError('Servicio de BD no encontrado');
  return svc;
}

async function createDbService(data, actor) {
  const { name, host } = data;

  if (!name || name.trim().length < 2)
    throw new ValidationError('El nombre es obligatorio');
  if (!host || host.trim().length < 2)
    throw new ValidationError('El host/endpoint es obligatorio');
  if (!data.environmentId)
    throw new ValidationError('El ambiente es obligatorio');

  const svc = await repo.createDbService({ ...data, createdBy: actor.id });

  await audit({
    actorId: actor.id, actorUsername: actor.username,
    action: AUDIT_ACTIONS.RESOURCE_DB_CREATE,
    resourceType: 'DB', resourceId: svc.id, resourceName: svc.code,
    result: RESULT.SUCCESS, ipAddress: actor.ip,
  });

  return svc;
}

async function updateDbService(id, data, actor) {
  const existing = await repo.findDbServiceById(id);
  if (!existing) throw new NotFoundError('Servicio de BD no encontrado');

  if (!data.name || data.name.trim().length < 2)
    throw new ValidationError('El nombre es obligatorio');
  if (!data.host || data.host.trim().length < 2)
    throw new ValidationError('El host/endpoint es obligatorio');
  if (!data.environmentId)
    throw new ValidationError('El ambiente es obligatorio');

  const updated = await repo.updateDbService(id, data);
  if (!updated) throw new NotFoundError('Servicio de BD no encontrado');

  await audit({
    actorId: actor.id, actorUsername: actor.username,
    action: AUDIT_ACTIONS.RESOURCE_DB_UPDATE,
    resourceType: 'DB', resourceId: id, resourceName: existing.code,
    result: RESULT.SUCCESS, ipAddress: actor.ip,
  });

  return updated;
}

async function toggleDbServiceEstado(id, actor) {
  const existing = await repo.findDbServiceById(id);
  if (!existing) throw new NotFoundError('Servicio de BD no encontrado');

  // Solo se comprueba al DESACTIVAR: el toggle es bidireccional y reactivar debe
  // seguir siendo posible siempre.
  //
  // Motivo: desactivar un servicio de BD no cortaba nada. El descifrado filtra por el estado
  // de la CREDENCIAL, nunca por el del recurso que la contiene, asi que sus
  // contrasenas se seguian listando y descifrando igual. Quien da de baja un servicio
  // y lo desactiva cree razonablemente que ha cerrado ese acceso. Se niega la
  // accion, igual que ya hacia el borrado, en vez de dejar un control que
  // aparenta funcionar.
  if (existing.estado === 'AI') {
    const creds = await repo.countCredentialsByDbService(id);
    if (creds > 0) {
      throw new ValidationError(
        `No se puede desactivar: el servicio tiene ${creds} credencial(es) activa(s). ` +
        'Eliminalas o muevelas antes de darlo de baja.'
      );
    }
  }

  const updated = await repo.toggleDbServiceEstado(id);
  if (!updated) throw new NotFoundError('Servicio de BD no encontrado');

  await audit({
    actorId: actor.id, actorUsername: actor.username,
    action: AUDIT_ACTIONS.RESOURCE_DB_UPDATE,
    resourceType: 'DB', resourceId: id, resourceName: updated.code,
    result: RESULT.SUCCESS, ipAddress: actor.ip,
    extra: { estado: updated.estado },
  });

  return updated;
}

async function deleteDbService(id, actor) {
  const existing = await repo.findDbServiceById(id);
  if (!existing) throw new NotFoundError('Servicio de BD no encontrado');

  const creds = await repo.countCredentialsByDbService(id);
  if (creds > 0)
    throw new ValidationError(`No se puede eliminar: el servicio tiene ${creds} credencial(es) activa(s)`);

  const deleted = await repo.softDeleteDbService(id);

  await audit({
    actorId: actor.id, actorUsername: actor.username,
    action: AUDIT_ACTIONS.RESOURCE_DB_DELETE,
    resourceType: 'DB', resourceId: id, resourceName: existing.code,
    result: RESULT.SUCCESS, ipAddress: actor.ip,
  });

  return deleted;
}

module.exports = {
  getCatalogs,
  // Servers
  listServers, getServer, createServer, updateServer, toggleServerEstado, deleteServer,
  // DB Services
  listDbServices, getDbService, createDbService, updateDbService, toggleDbServiceEstado, deleteDbService,
};
