'use strict';

const repo      = require('../repositories/applications.repository');
const { query } = require('../config/database');
const { AUDIT_ACTIONS, RESULT } = require('../config/constants');
const logger    = require('../utils/logger');
// Acceso de consulta por tipo: solo se modifica lo del propio equipo (migración 022).
const teamAccess = require('./teamAccess');

// =============================================================================
// applications.service.js — Lógica de negocio para tbl_applications.
// Modelo plano: una app por registro, server_id opcional.
// =============================================================================

const APP_TYPES = ['WEB', 'API', 'SERVICE', 'OTHER'];

class ValidationError extends Error {
  constructor(msg) { super(msg); this.name = 'ValidationError'; this.isValidation = true; }
}
class NotFoundError extends Error {
  constructor(msg) { super(msg); this.name = 'NotFoundError'; this.isNotFound = true; }
}

async function audit({ actorId, actorUsername, action, resourceId, resourceName, result, ipAddress, extra }) {
  try {
    await query(
      `INSERT INTO sch_audit.tbl_audit_log
         (user_id, username, action, resource_type, resource_id, resource_name,
          result, ip_address, extra_data)
       VALUES ($1,$2,$3,'APP',$4,$5,$6,$7,$8)`,
      [actorId, actorUsername, action,
       resourceId ? String(resourceId) : null, resourceName || null,
       result, ipAddress || null, JSON.stringify(extra || {})]
    );
  } catch (err) {
    logger.error('Error auditoría applications:', { code: err.code });
  }
}

async function listApplications({ page, limit, search, environmentId, appType } = {}) {
  return repo.findAll({ page, limit, search, environmentId, appType });
}

async function getApplication(id) {
  const app = await repo.findById(id);
  if (!app) throw new NotFoundError('Aplicación no encontrada');
  return app;
}

async function createApplication(data, actor) {
  const { name, appType, environmentId } = data;

  if (!name || name.trim().length < 2)
    throw new ValidationError('El nombre es obligatorio');
  if (!environmentId)
    throw new ValidationError('El ambiente es obligatorio');
  if (appType && !APP_TYPES.includes(appType))
    throw new ValidationError(`Tipo de app inválido. Valores permitidos: ${APP_TYPES.join(', ')}`);

  const app = await repo.create({ ...data, createdBy: actor.id, ownerTeamId: teamAccess.ownerTeamFor(actor) });

  await audit({
    actorId: actor.id, actorUsername: actor.username,
    action: AUDIT_ACTIONS.RESOURCE_APP_CREATE,
    resourceId: app.id, resourceName: app.code,
    result: RESULT.SUCCESS, ipAddress: actor.ip,
  });

  return app;
}

async function updateApplication(id, data, actor) {
  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError('Aplicación no encontrada');
  teamAccess.assertCanModify(actor, 'APP', existing.owner_team_id);

  const { name, appType, environmentId } = data;

  if (!name || name.trim().length < 2)
    throw new ValidationError('El nombre es obligatorio');
  if (!environmentId)
    throw new ValidationError('El ambiente es obligatorio');
  if (appType && !APP_TYPES.includes(appType))
    throw new ValidationError(`Tipo de app inválido. Valores permitidos: ${APP_TYPES.join(', ')}`);

  const updated = await repo.update(id, data);
  if (!updated) throw new NotFoundError('Aplicación no encontrada');

  await audit({
    actorId: actor.id, actorUsername: actor.username,
    action: AUDIT_ACTIONS.RESOURCE_APP_UPDATE,
    resourceId: id, resourceName: existing.code,
    result: RESULT.SUCCESS, ipAddress: actor.ip,
  });

  return updated;
}

async function toggleApplicationEstado(id, actor) {
  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError('Aplicación no encontrada');
  teamAccess.assertCanModify(actor, 'APP', existing.owner_team_id);

  // Solo se comprueba al DESACTIVAR: el toggle es bidireccional y reactivar debe
  // seguir siendo posible siempre.
  //
  // Motivo: desactivar una aplicacion no cortaba nada. El descifrado filtra por el estado
  // de la CREDENCIAL, nunca por el del recurso que la contiene, asi que sus
  // contrasenas se seguian listando y descifrando igual. Quien da de baja una aplicacion
  // y la desactiva cree razonablemente que ha cerrado ese acceso. Se niega la
  // accion, igual que ya hacia el borrado, en vez de dejar un control que
  // aparenta funcionar.
  if (existing.estado === 'AI') {
    const creds = await repo.countCredentials(id);
    if (creds > 0) {
      throw new ValidationError(
        `No se puede desactivar: la aplicación tiene ${creds} credencial(es) activa(s). ` +
        'Eliminalas o muevelas antes de darla de baja.'
      );
    }
  }

  const updated = await repo.toggleEstado(id);
  if (!updated) throw new NotFoundError('Aplicación no encontrada');

  await audit({
    actorId: actor.id, actorUsername: actor.username,
    action: AUDIT_ACTIONS.RESOURCE_APP_UPDATE,
    resourceId: id, resourceName: updated.code,
    result: RESULT.SUCCESS, ipAddress: actor.ip,
    extra: { estado: updated.estado },
  });

  return updated;
}

async function deleteApplication(id, actor) {
  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError('Aplicación no encontrada');
  teamAccess.assertCanModify(actor, 'APP', existing.owner_team_id);

  const creds = await repo.countCredentials(id);
  if (creds > 0)
    throw new ValidationError(`No se puede eliminar: la aplicación tiene ${creds} credencial(es) activa(s)`);

  const deleted = await repo.softDelete(id);

  await audit({
    actorId: actor.id, actorUsername: actor.username,
    action: AUDIT_ACTIONS.RESOURCE_APP_DELETE,
    resourceId: id, resourceName: existing.code,
    result: RESULT.SUCCESS, ipAddress: actor.ip,
  });

  return deleted;
}

module.exports = {
  listApplications, getApplication,
  createApplication, updateApplication, toggleApplicationEstado, deleteApplication,
};
