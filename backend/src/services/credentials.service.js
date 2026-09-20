'use strict';

const repo        = require('../repositories/credentials.repository');
const catalogsRepo = require('../repositories/catalogs.repository');
const { query, withTransaction } = require('../config/database');
const { AUDIT_ACTIONS, RESULT, ROLE_LEVELS } = require('../config/constants');
const logger = require('../utils/logger');
const custody = require('./custody');

// =============================================================================
// credentials.service.js — Lógica de negocio para gestión de credenciales.
//
// ORDEN DE VALIDACIÓN (por el spec):
//   1. Autenticación   → verifyToken (middleware)
//   2. Rol             → requireRole (middleware)
//   3. Ámbito de equipo → getResourceTypeForUser() en este servicio
//   4. Custodia        → checkCustody() en este servicio (solo para decrypt)
//
// REGLAS ABSOLUTAS:
//   - La contraseña NUNCA se loguea, nunca se devuelve en lista/detalle.
//   - El descifrado solo ocurre en decryptPassword(), con auditoría obligatoria.
//   - ADMIN ve todas las credenciales y no puede descifrar una credencial
//     custodiada por otro. Sí puede reasignarse la custodia primero
//     (PATCH /credentials/:id/custodian): es la via de emergencia para cuando
//     el custodio deja la organizacion, y queda auditada como
//     CUSTODIAN_REASSIGN con selfAssigned=true. La garantia real es la
//     trazabilidad, no la imposibilidad.
//   - is_prd_access = TRUE si el ambiente de la instancia tiene prd_flag.
// =============================================================================

// ---------------------------------------------------------------------------
// Errores de dominio
// ---------------------------------------------------------------------------
class ValidationError extends Error {
  constructor(msg) { super(msg); this.name = 'ValidationError'; this.isValidation = true; }
}
class NotFoundError extends Error {
  constructor(msg) { super(msg); this.name = 'NotFoundError'; this.isNotFound = true; }
}
class ForbiddenError extends Error {
  constructor(msg) { super(msg); this.name = 'ForbiddenError'; this.isForbidden = true; }
}

// ---------------------------------------------------------------------------
// Helper: tipos de recurso permitidos según el nivel y equipo del actor.
// Devuelve array de tipos o null (null = sin restricción para ADMIN).
// ---------------------------------------------------------------------------
function getResourceTypesForUser(user) {
  if (user.level >= ROLE_LEVELS.ADMIN) return null;          // ADMIN: ve todo
  // Un no-ADMIN sin tipos de recurso NO tiene ambito: se devuelve el array
  // vacio, que los consumidores traducen en "ninguno" (el filtro SQL es
  // `resource_type = ANY($n)`, que con {} no devuelve filas). Devolver null
  // aqui significaba "sin restriccion" y le abria TODOS los tipos, justo al
  // reves de lo que hace requireTeamScope (plugins/rbac.js) para recursos.
  return user.teamResourceTypes || [];
}

// ---------------------------------------------------------------------------
// Helper de auditoría
// ---------------------------------------------------------------------------
async function auditAction({
  actorId, actorUsername, action,
  resourceId, resourceName, resourceType,
  result, failReason, ipAddress,
  isPrdAccess, isCustodiedAccess, extra,
  // required: la operación se cancela si el registro no llega a escribirse.
  // Solo lo usa el descifrado con resultado correcto: entregar una contraseña
  // sin dejar rastro es peor que no entregarla. El resto de llamadas siguen
  // siendo best effort — si fallan, la acción ya se denegó de todos modos.
  required = false,
}) {
  try {
    await query(
      `INSERT INTO sch_audit.tbl_audit_log
         (user_id, username, action, resource_type, resource_id, resource_name,
          result, fail_reason, ip_address,
          is_prd_access, is_custodied_access, extra_data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        actorId,
        actorUsername,
        action,
        resourceType  || 'DB',
        resourceId    ? String(resourceId) : null,
        resourceName  || null,
        result,
        failReason    || null,
        ipAddress     || null,
        isPrdAccess        || false,
        isCustodiedAccess  || false,
        JSON.stringify(extra || {}),
      ]
    );
  } catch (err) {
    logger.error('Error en auditoría de credenciales:', { code: err.code, action, required });
    if (required) {
      throw new Error('No se pudo registrar la auditoría de la operación. Operación cancelada.');
    }
  }
}

// ---------------------------------------------------------------------------
// Helper: nombre del recurso para auditoría (DB, OS y APP)
// ---------------------------------------------------------------------------
function resourceName(cred) {
  // Alias de credentials.repository: server_code, db_code y app_code.
  const codes = { OS: cred.server_code, DB: cred.db_code, APP: cred.app_code };
  return `${codes[cred.resource_type] || '?'}/${cred.username}`;
}

// ---------------------------------------------------------------------------
// Catálogos
// ---------------------------------------------------------------------------
async function getCatalogs(actor) {
  const allowedTypes = getResourceTypesForUser(actor);

  const [dbInstances, serverInstances, applications, users, environments] = await Promise.all([
    (allowedTypes === null || allowedTypes.includes('DB'))
      ? repo.findAvailableDbServices()
      : Promise.resolve([]),
    (allowedTypes === null || allowedTypes.includes('OS'))
      ? repo.findAvailableServers()
      : Promise.resolve([]),
    (allowedTypes === null || allowedTypes.includes('APP'))
      ? repo.findAvailableApplications()
      : Promise.resolve([]),
    actor.level >= ROLE_LEVELS.ADMIN ? repo.findActiveUsers() : Promise.resolve([]),
    catalogsRepo.findAllEnvironments(),
  ]);
  return { dbInstances, serverInstances, applications, users, environments };
}

// ---------------------------------------------------------------------------
// Listado y detalle
// ---------------------------------------------------------------------------
async function listCredentials({ page, limit, search, environmentId, filterResourceType, custodied, estado }, actor) {
  const resourceTypes = getResourceTypesForUser(actor);
  return repo.findAll({ page, limit, search, resourceTypes, environmentId, filterResourceType, custodied, estado });
}

async function getCredential(id, actor) {
  const cred = await repo.findById(id);
  if (!cred) throw new NotFoundError('Credencial no encontrada.');

  // Verificar ámbito de equipo
  const allowedTypes = getResourceTypesForUser(actor);
  if (allowedTypes && !allowedTypes.includes(cred.resource_type)) {
    throw new ForbiddenError('No tienes acceso a este tipo de credencial.');
  }

  await auditAction({
    actorId:      actor.id,
    actorUsername: actor.username,
    action:       AUDIT_ACTIONS.CREDENTIAL_VIEW,
    resourceId:   cred.id,
    resourceName: resourceName(cred),
    resourceType: cred.resource_type,
    result:       RESULT.SUCCESS,
    ipAddress:    actor.ip,
    isPrdAccess:       cred.prd_flag || false,
    isCustodiedAccess: cred.is_custodied,
  });

  return cred;
}

// ---------------------------------------------------------------------------
// Descifrado — Endpoint explícito, auditado obligatoriamente
// ---------------------------------------------------------------------------

/**
 * Descifra la contraseña de una credencial.
 *
 * ORDEN DE VALIDACIÓN:
 *   1. Existencia de la credencial.
 *   2. Ámbito de equipo (team scope).
 *   3. Custodia exclusiva — aplica INCLUSO para ADMIN.
 *   4. Descifrado con pgp_sym_decrypt vía repo.decryptPassword().
 *   5. Auditoría. La del descifrado correcto es BLOQUEANTE (required): si no se
 *      puede registrar, no se devuelve la contraseña.
 *
 * @returns {{ plain_password: string }}
 */
async function decryptPassword(id, actor) {
  const cred = await repo.findById(id);

  if (!cred) {
    await auditAction({
      actorId: actor.id, actorUsername: actor.username,
      action: AUDIT_ACTIONS.CREDENTIAL_DECRYPT,
      resourceId: id, result: RESULT.FAIL,
      failReason: 'Credencial no encontrada.',
      ipAddress: actor.ip,
    });
    throw new NotFoundError('Credencial no encontrada.');
  }

  if (cred.estado !== 'AI') {
    // Se audita igual que las otras dos denegaciones: sin esto se podria
    // sondear que credenciales estan inactivas sin dejar rastro, y se rompia
    // la garantia de que todo intento de descifrado queda registrado.
    await auditAction({
      actorId: actor.id, actorUsername: actor.username,
      action: AUDIT_ACTIONS.CREDENTIAL_DECRYPT,
      resourceId: cred.id,
      resourceName: resourceName(cred),
      resourceType: cred.resource_type,
      result: RESULT.FAIL,
      failReason: 'Credencial inactiva.',
      ipAddress: actor.ip,
      isPrdAccess: cred.prd_flag || false,
      isCustodiedAccess: cred.is_custodied,
    });
    throw new ForbiddenError('La credencial está inactiva y no puede descifrarse.');
  }

  // Verificar ámbito de equipo
  const allowedTypes = getResourceTypesForUser(actor);
  if (allowedTypes && !allowedTypes.includes(cred.resource_type)) {
    await auditAction({
      actorId: actor.id, actorUsername: actor.username,
      action: AUDIT_ACTIONS.CREDENTIAL_DECRYPT,
      resourceId: cred.id,
      resourceName: resourceName(cred),
      resourceType: cred.resource_type,
      result: RESULT.FAIL,
      failReason: 'Acceso denegado por ámbito de equipo.',
      ipAddress: actor.ip,
      isPrdAccess: cred.prd_flag || false,
      isCustodiedAccess: cred.is_custodied,
    });
    throw new ForbiddenError('No tienes acceso a este tipo de credencial.');
  }

  // =========================================================================
  // CUSTODIA EXCLUSIVA — aplica tambien a ADMIN: ni con nivel 100 se descifra
  // una credencial custodiada por otro. Un ADMIN puede reasignarse la custodia
  // antes, pero eso deja rastro propio en auditoria (ver reassignCustodian).
  // =========================================================================
  if (cred.is_custodied && cred.custodian_user_id !== actor.id) {
    await auditAction({
      actorId: actor.id, actorUsername: actor.username,
      action: AUDIT_ACTIONS.CUSTODIED_ACCESS_DENIED,
      resourceId: cred.id,
      resourceName: resourceName(cred),
      resourceType: cred.resource_type,
      result: RESULT.FAIL,
      failReason: 'Acceso denegado: credencial custodiada.',
      ipAddress: actor.ip,
      isPrdAccess: cred.prd_flag || false,
      isCustodiedAccess: true,
      extra: { custodian: cred.custodian_username },
    });
    throw new ForbiddenError(
      'Credencial custodiada. Solo el custodio asignado puede descifrar esta contraseña.'
    );
  }

  // Descifrar — la MASTER_KEY va desde process.env, nunca del request
  const masterKey = process.env.MASTER_KEY;
  if (!masterKey) {
    logger.error('MASTER_KEY no configurada en variables de entorno.');
    throw new Error('Error de configuración del servidor.');
  }

  const decrypted = await repo.decryptPassword(id, masterKey);
  if (!decrypted) {
    logger.error('decryptPassword: pgcrypto no retornó datos. Posible desincronía de Master Key.', { credId: id });
    throw new Error('Error interno al descifrar la credencial. Contacta al administrador.');
  }

  // Bloqueante a proposito: si este INSERT falla, la contraseña no sale de aqui.
  await auditAction({
    actorId: actor.id, actorUsername: actor.username,
    action: AUDIT_ACTIONS.CREDENTIAL_DECRYPT,
    resourceId: cred.id,
    resourceName: resourceName(cred),
    resourceType: cred.resource_type,
    result: RESULT.SUCCESS,
    ipAddress: actor.ip,
    isPrdAccess:       cred.prd_flag    || false,
    isCustodiedAccess: cred.is_custodied || false,
    extra: {
      environment: cred.environment_code,
      infrastructure: cred.infrastructure_code,
    },
    required: true,
  });

  logger.info('Contraseña descifrada.', {
    credId:   cred.id,
    resource: cred.database_code || cred.server_code,
    env:      cred.environment_code,
    by:       actor.username,
    prd:      cred.prd_flag,
  });

  return { plain_password: decrypted.plain_password };
}

// ---------------------------------------------------------------------------
// Creación
// ---------------------------------------------------------------------------
async function createCredential(data, actor) {
  const {
    instanceId, resourceType: reqResourceType,
    username, password,
    description, notes, isCustodied, custodianUserId,
  } = data;

  if (!instanceId) throw new ValidationError('La instancia es obligatoria.');
  if (!username || !username.trim()) throw new ValidationError('El username de la credencial es obligatorio.');
  if (!password) throw new ValidationError('La contraseña es obligatoria.');

  // Determinar resource_type:
  //   - ADMIN: debe enviarlo explícitamente (ve todos los tipos).
  //   - No-ADMIN con un solo tipo en su equipo: se infiere automáticamente.
  //   - No-ADMIN con múltiples tipos: debe enviarlo explícitamente (validado contra su scope).
  const VALID_TYPES = ['DB', 'OS', 'APP'];
  let resourceType;
  if (actor.level >= ROLE_LEVELS.ADMIN) {
    if (!reqResourceType || !VALID_TYPES.includes(reqResourceType)) {
      throw new ValidationError('El tipo de recurso (DB/OS/APP) es obligatorio para ADMIN.');
    }
    resourceType = reqResourceType;
  } else {
    const allowedTypes = getResourceTypesForUser(actor);
    if (!allowedTypes || allowedTypes.length === 0) {
      throw new ValidationError('No se pudo determinar el tipo de recurso para este usuario.');
    }
    if (allowedTypes.length === 1) {
      // Un tipo pedido que no es el del equipo se rechaza. Antes se ignoraba y
      // el instanceId se interpretaba como un recurso del tipo del equipo: nunca
      // salía de su ámbito, pero podía crear la credencial donde no se pidió.
      if (reqResourceType && reqResourceType !== allowedTypes[0]) {
        throw new ForbiddenError(`Tu equipo no tiene acceso a recursos de tipo ${reqResourceType}.`);
      }
      resourceType = allowedTypes[0];
    } else {
      // Equipo con múltiples tipos: el frontend debe enviar resourceType
      if (!reqResourceType || !VALID_TYPES.includes(reqResourceType)) {
        throw new ValidationError('Tu equipo gestiona múltiples tipos de recurso. Indica el tipo (DB/OS/APP) al crear la credencial.');
      }
      if (!allowedTypes.includes(reqResourceType)) {
        throw new ForbiddenError(`Tu equipo no tiene acceso a recursos de tipo ${reqResourceType}.`);
      }
      resourceType = reqResourceType;
    }
  }

  const dbServiceId    = resourceType === 'DB'  ? parseInt(instanceId, 10) : null;
  const serverId       = resourceType === 'OS'  ? parseInt(instanceId, 10) : null;
  const applicationId  = resourceType === 'APP' ? parseInt(instanceId, 10) : null;

  // Verificar que la instancia existe y está activa
  let instance = null;
  if (resourceType === 'DB') {
    instance = await repo.findDbServiceById(dbServiceId);
    if (!instance) throw new ValidationError('El servicio de base de datos indicado no existe o no está activo.');
  } else if (resourceType === 'OS') {
    instance = await repo.findServerById(serverId);
    if (!instance) throw new ValidationError('El servidor indicado no existe o no está activo.');
  } else if (resourceType === 'APP') {
    instance = await repo.findApplicationById(applicationId);
    if (!instance) throw new ValidationError('La aplicación indicada no existe o no está activa.');
  }

  // Custodia: cualquier usuario con CRED_EDIT puede auto-custodiarse.
  // Solo ADMIN puede asignar a otro usuario como custodio.
  let finalCustodied   = false;
  let finalCustodianId = null;
  if (isCustodied) {
    if (actor.level >= ROLE_LEVELS.ADMIN) {
      // ADMIN: debe indicar explícitamente el custodio
      if (!custodianUserId) {
        throw new ValidationError('Debe especificar un custodio para la credencial custodiada.');
      }
      finalCustodianId = custodianUserId;
    } else {
      // No-ADMIN: solo puede custodiarse a sí mismo
      if (custodianUserId && custodianUserId !== actor.id) {
        throw new ForbiddenError('Solo ADMIN puede asignar la custodia a otro usuario.');
      }
      finalCustodianId = actor.id;
    }

    // El custodio tiene que poder DESCIFRARLA, no solo existir: si no, la
    // credencial nace sin nadie capaz de abrirla. Antes solo se comprobaba que
    // estuviera activo, y solo cuando lo elegía un ADMIN: un usuario sin
    // CRED_REVEAL podía custodiarse a sí mismo una credencial que no puede ver.
    const motivo = custody.motivoSinAcceso(
      await custody.capacidadDeUsuario({ query }, finalCustodianId),
      resourceType
    );
    if (motivo) {
      throw new ValidationError(`El custodio no podría descifrar esta credencial: ${motivo}.`);
    }
    finalCustodied = true;
  }

  const cred = await repo.create({
    dbServiceId,
    serverId,
    applicationId,
    resourceType,
    username,
    plainPassword: password,
    description,
    notes,
    isCustodied:     finalCustodied,
    custodianUserId: finalCustodianId,
    createdBy:       actor.id,
  });

  await auditAction({
    actorId:      actor.id,
    actorUsername: actor.username,
    action:       AUDIT_ACTIONS.CREDENTIAL_CREATE,
    resourceId:   cred.id,
    // Mismo formato CÓDIGO/usuario que el resto de eventos de la credencial;
    // antes el alta guardaba solo el usuario y no marcaba el acceso a PRD.
    resourceName: `${instance?.code || '?'}/${cred.username}`,
    resourceType,
    result:       RESULT.SUCCESS,
    ipAddress:    actor.ip,
    isPrdAccess:  instance?.prd_flag || false,
    extra:        { isCustodied: finalCustodied, custodianUserId: finalCustodianId },
  });

  logger.info('Credencial creada.', { id: cred.id, username: cred.username, type: resourceType, by: actor.username });
  return cred;
}

// ---------------------------------------------------------------------------
// Actualización
// ---------------------------------------------------------------------------
async function updateCredential(id, data, actor) {
  const { username, description, notes, newPassword } = data;

  const cred = await repo.findById(id);
  if (!cred) throw new NotFoundError('Credencial no encontrada.');

  // Verificar ámbito
  const allowedTypes = getResourceTypesForUser(actor);
  if (allowedTypes && !allowedTypes.includes(cred.resource_type)) {
    throw new ForbiddenError('No tienes acceso a este tipo de credencial.');
  }

  // Custodia exclusiva — solo el custodio puede editar
  if (cred.is_custodied && cred.custodian_user_id !== actor.id) {
    await auditAction({
      actorId: actor.id, actorUsername: actor.username,
      action: AUDIT_ACTIONS.CUSTODIED_ACCESS_DENIED,
      resourceId: cred.id, resourceName: resourceName(cred), resourceType: cred.resource_type,
      result: RESULT.FAIL, failReason: 'Edición denegada: credencial custodiada.',
      ipAddress: actor.ip, isPrdAccess: cred.prd_flag || false, isCustodiedAccess: true,
      extra: { custodian: cred.custodian_username },
    });
    throw new ForbiddenError('Credencial custodiada. Solo el custodio asignado puede editarla.');
  }

  if (!username || !username.trim()) throw new ValidationError('El username es obligatorio.');

  // Metadatos y, si se indica, contraseña nueva: una sola transacción en el
  // repositorio, coordinada con la rotación de Master Key.
  const updated = await repo.update(id, { username, description, notes, newPassword });

  await auditAction({
    actorId:      actor.id,
    actorUsername: actor.username,
    action:       AUDIT_ACTIONS.CREDENTIAL_UPDATE,
    resourceId:   cred.id,
    resourceName: resourceName(cred),
    resourceType: cred.resource_type,
    result:       RESULT.SUCCESS,
    ipAddress:    actor.ip,
    isPrdAccess:  cred.prd_flag || false,
    extra:        { passwordChanged: !!newPassword },
  });

  logger.info('Credencial actualizada.', { id, by: actor.username });
  return updated;
}

// ---------------------------------------------------------------------------
// Toggle estado
// ---------------------------------------------------------------------------
async function toggleEstado(id, actor) {
  const cred = await repo.findById(id);
  if (!cred) throw new NotFoundError('Credencial no encontrada.');

  const allowedTypes = getResourceTypesForUser(actor);
  if (allowedTypes && !allowedTypes.includes(cred.resource_type)) {
    throw new ForbiddenError('No tienes acceso a este tipo de credencial.');
  }

  // Custodia exclusiva — solo el custodio puede activar/desactivar
  if (cred.is_custodied && cred.custodian_user_id !== actor.id) {
    await auditAction({
      actorId: actor.id, actorUsername: actor.username,
      action: AUDIT_ACTIONS.CUSTODIED_ACCESS_DENIED,
      resourceId: cred.id, resourceName: resourceName(cred), resourceType: cred.resource_type,
      result: RESULT.FAIL, failReason: 'Toggle estado denegado: credencial custodiada.',
      ipAddress: actor.ip, isPrdAccess: cred.prd_flag || false, isCustodiedAccess: true,
      extra: { custodian: cred.custodian_username },
    });
    throw new ForbiddenError('Credencial custodiada. Solo el custodio asignado puede cambiar su estado.');
  }

  const newEstado = cred.estado === 'AI' ? 'IN' : 'AI';
  const updated   = await repo.setEstado(id, newEstado);

  await auditAction({
    actorId:      actor.id,
    actorUsername: actor.username,
    action:       AUDIT_ACTIONS.CREDENTIAL_UPDATE,
    resourceId:   cred.id,
    resourceName: resourceName(cred),
    resourceType: cred.resource_type,
    result:       RESULT.SUCCESS,
    ipAddress:    actor.ip,
    isPrdAccess:  cred.prd_flag || false,
    extra:        { nuevoEstado: newEstado },
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Soft delete
// ---------------------------------------------------------------------------
async function deleteCredential(id, actor) {
  const cred = await repo.findById(id);
  if (!cred) throw new NotFoundError('Credencial no encontrada.');

  const allowedTypes = getResourceTypesForUser(actor);
  if (allowedTypes && !allowedTypes.includes(cred.resource_type)) {
    throw new ForbiddenError('No tienes acceso a este tipo de credencial.');
  }

  // Custodia exclusiva — solo el custodio puede eliminar
  if (cred.is_custodied && cred.custodian_user_id !== actor.id) {
    await auditAction({
      actorId: actor.id, actorUsername: actor.username,
      action: AUDIT_ACTIONS.CUSTODIED_ACCESS_DENIED,
      resourceId: cred.id, resourceName: resourceName(cred), resourceType: cred.resource_type,
      result: RESULT.FAIL, failReason: 'Eliminación denegada: credencial custodiada.',
      ipAddress: actor.ip, isPrdAccess: cred.prd_flag || false, isCustodiedAccess: true,
      extra: { custodian: cred.custodian_username },
    });
    throw new ForbiddenError('Credencial custodiada. Solo el custodio asignado puede eliminarla.');
  }

  await repo.softDelete(id);

  await auditAction({
    actorId:      actor.id,
    actorUsername: actor.username,
    action:       AUDIT_ACTIONS.CREDENTIAL_DELETE,
    resourceId:   cred.id,
    resourceName: resourceName(cred),
    resourceType: cred.resource_type,
    result:       RESULT.SUCCESS,
    ipAddress:    actor.ip,
    isPrdAccess:  cred.prd_flag || false,
    extra:        { tipo: 'eliminacion_logica' },
  });

  logger.info('Credencial eliminada lógicamente.', { id, by: actor.username });
  return { success: true };
}

// ---------------------------------------------------------------------------
// Reasignación de custodio — solo ADMIN
// ---------------------------------------------------------------------------
async function reassignCustodian(id, newCustodianUserId, actor) {
  if (actor.level < ROLE_LEVELS.ADMIN) {
    throw new ForbiddenError('Solo ADMIN puede reasignar el custodio de una credencial.');
  }
  if (!newCustodianUserId) {
    throw new ValidationError('Debe especificar el nuevo custodio.');
  }

  const cred = await repo.findById(id);
  if (!cred) throw new NotFoundError('Credencial no encontrada.');
  if (!cred.is_custodied) {
    throw new ValidationError('Esta credencial no es custodiada.');
  }

  const previousCustodian = cred.custodian_username || cred.custodian_user_id;

  // Verificación del custodio y actualización en una sola transacción atómica.
  // capacidadDeUsuario bloquea la fila del usuario hasta el COMMIT, eliminando
  // la ventana TOCTOU entre la validación y la escritura. Y comprueba que el
  // nuevo custodio podrá DESCIFRAR la credencial, no solo que exista.
  let updated;
  await withTransaction(async (client) => {
    const capacidad = await custody.capacidadDeUsuario(client, newCustodianUserId, { bloquear: true });
    const motivo = custody.motivoSinAcceso(capacidad, cred.resource_type);
    if (motivo) {
      throw new ValidationError(`El nuevo custodio no podría descifrar esta credencial: ${motivo}.`);
    }

    const { rows } = await client.query(
      `UPDATE sch_secret.tbl_credentials
       SET custodian_user_id = $2,
           custodian_since   = NOW(),
           updated_at        = NOW()
       WHERE id = $1 AND estado_registro = 'O' AND is_custodied = TRUE
       RETURNING id, username, custodian_user_id`,
      [id, newCustodianUserId]
    );
    updated = rows[0] || null;
  });

  if (!updated) throw new NotFoundError('No se pudo actualizar el custodio.');

  await auditAction({
    actorId:      actor.id,
    actorUsername: actor.username,
    action:       AUDIT_ACTIONS.CUSTODIAN_REASSIGN,
    resourceId:   cred.id,
    resourceName: resourceName(cred),
    resourceType: cred.resource_type,
    result:       RESULT.SUCCESS,
    ipAddress:    actor.ip,
    isPrdAccess:       cred.prd_flag    || false,
    isCustodiedAccess: true,
    extra: {
      previousCustodian,
      newCustodianUserId,
      // Marca la via de emergencia: un ADMIN que se asigna a si mismo la
      // custodia puede descifrar a continuacion. Es legitimo, pero tiene que
      // poder localizarse en la auditoria de un vistazo.
      selfAssigned: newCustodianUserId === actor.id,
    },
  });

  logger.info('Custodio reasignado.', {
    credId: cred.id, prev: previousCustodian, newId: newCustodianUserId, by: actor.username,
  });
  return updated;
}

module.exports = {
  getCatalogs,
  listCredentials,
  getCredential,
  decryptPassword,
  createCredential,
  updateCredential,
  toggleEstado,
  deleteCredential,
  reassignCustodian,
  ValidationError,
  NotFoundError,
  ForbiddenError,
};
module.exports.resourceName = resourceName;
