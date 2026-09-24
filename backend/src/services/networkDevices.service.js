'use strict';

const repo      = require('../repositories/networkDevices.repository');
const resourcesRepo = require('../repositories/resources.repository');
const { query } = require('../config/database');
const { AUDIT_ACTIONS, RESULT } = require('../config/constants');
const logger    = require('../utils/logger');

// =============================================================================
// networkDevices.service.js — Lógica de negocio para tbl_network_devices.
// Mismas reglas que servidores y aplicaciones:
//   - El code es único e inmutable (se genera al crear).
//   - No se desactiva ni elimina un dispositivo con credenciales activas.
//   - resource_type auditado: 'NET'.
// =============================================================================

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
       VALUES ($1,$2,$3,'NET',$4,$5,$6,$7,$8)`,
      [actorId, actorUsername, action,
       resourceId ? String(resourceId) : null, resourceName || null,
       result, ipAddress || null, JSON.stringify(extra || {})]
    );
  } catch (err) {
    logger.error('Error auditoría dispositivos de red:', { code: err.code });
  }
}

async function getCatalogs() {
  const [environments, infrastructures, networkProducts] = await Promise.all([
    resourcesRepo.findAllEnvironments(),
    resourcesRepo.findAllInfrastructures(),
    repo.findAllNetworkProducts(),
  ]);
  return { environments, infrastructures, networkProducts };
}

async function listDevices({ page, limit, search, environmentId, infrastructureId, productId } = {}) {
  return repo.findAll({ page, limit, search, environmentId, infrastructureId, productId });
}

async function getDevice(id) {
  const device = await repo.findById(id);
  if (!device) throw new NotFoundError('Dispositivo de red no encontrado');
  return device;
}

async function createDevice(data, actor) {
  const device = await repo.create({ ...data, createdBy: actor.id });

  await audit({
    actorId: actor.id, actorUsername: actor.username,
    action: AUDIT_ACTIONS.RESOURCE_NET_CREATE,
    resourceId: device.id, resourceName: device.code,
    result: RESULT.SUCCESS, ipAddress: actor.ip,
  });

  return device;
}

async function updateDevice(id, data, actor) {
  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError('Dispositivo de red no encontrado');

  const updated = await repo.update(id, data);
  if (!updated) throw new NotFoundError('Dispositivo de red no encontrado');

  await audit({
    actorId: actor.id, actorUsername: actor.username,
    action: AUDIT_ACTIONS.RESOURCE_NET_UPDATE,
    resourceId: id, resourceName: existing.code,
    result: RESULT.SUCCESS, ipAddress: actor.ip,
  });

  return updated;
}

async function toggleDeviceEstado(id, actor) {
  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError('Dispositivo de red no encontrado');

  // Solo al DESACTIVAR, igual que servidores y aplicaciones: el descifrado
  // filtra por el estado de la credencial, no por el del recurso, así que
  // desactivar un dispositivo con credenciales no cerraría ningún acceso.
  if (existing.estado === 'AI') {
    const creds = await repo.countCredentials(id);
    if (creds > 0) {
      throw new ValidationError(
        `No se puede desactivar: el dispositivo tiene ${creds} credencial(es) activa(s). ` +
        'Elimínalas o muévelas antes de darlo de baja.'
      );
    }
  }

  const updated = await repo.toggleEstado(id);
  if (!updated) throw new NotFoundError('Dispositivo de red no encontrado');

  await audit({
    actorId: actor.id, actorUsername: actor.username,
    action: AUDIT_ACTIONS.RESOURCE_NET_UPDATE,
    resourceId: id, resourceName: updated.code,
    result: RESULT.SUCCESS, ipAddress: actor.ip,
    extra: { estado: updated.estado },
  });

  return updated;
}

async function deleteDevice(id, actor) {
  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError('Dispositivo de red no encontrado');

  const creds = await repo.countCredentials(id);
  if (creds > 0) {
    throw new ValidationError(`No se puede eliminar: el dispositivo tiene ${creds} credencial(es) activa(s)`);
  }

  const deleted = await repo.softDelete(id);

  await audit({
    actorId: actor.id, actorUsername: actor.username,
    action: AUDIT_ACTIONS.RESOURCE_NET_DELETE,
    resourceId: id, resourceName: existing.code,
    result: RESULT.SUCCESS, ipAddress: actor.ip,
  });

  return deleted;
}

module.exports = {
  getCatalogs, listDevices, getDevice,
  createDevice, updateDevice, toggleDeviceEstado, deleteDevice,
};
