'use strict';

const bcrypt = require('bcryptjs');
const repo   = require('../repositories/users.repository');
const { query } = require('../config/database');
const { validatePasswordStrength, PASSWORD_MIN_LENGTH_FLOOR } = require('../utils/crypto');
const { AUDIT_ACTIONS, RESULT, ROLE_LEVELS } = require('../config/constants');
const settings = require('../config/settings');
const logger = require('../utils/logger');
const custody = require('./custody');

// =============================================================================
// users.service.js — Lógica de negocio para administración de usuarios.
// Accesible solo por ADMIN (enforced en rutas).
//
// Reglas de negocio críticas:
//   - ADMIN no requiere team_id.
//   - VISITOR no requiere team_id.
//   - OPERATOR y VIEWER REQUIEREN team_id.
//   - No se puede eliminar el último ADMIN activo del sistema.
//   - No se puede auto-eliminar (un admin no puede borrarse a sí mismo).
// =============================================================================

async function auditAction({ actorId, actorUsername, action, targetId, targetUsername, result, extra, ipAddress }) {
  try {
    await query(
      `INSERT INTO sch_audit.tbl_audit_log
         (user_id, username, action, resource_type, resource_id, resource_name,
          result, ip_address, extra_data)
       VALUES ($1, $2, $3, 'SYS', $4, $5, $6, $7, $8)`,
      [
        actorId, actorUsername, action,
        targetId   || null,
        targetUsername || null,
        result,
        ipAddress || null,
        JSON.stringify(extra || {}),
      ]
    );
  } catch (err) {
    logger.error('Error en auditoría de usuarios:', { code: err.code });
  }
}

/**
 * Lista usuarios con paginación y búsqueda.
 */
async function listUsers({ page, limit, search, roleCode, teamCode, estado }) {
  return repo.findAll({ page, limit, search, roleCode, teamCode, estado });
}

/**
 * Obtiene un usuario por ID.
 */
async function getUser(id) {
  const user = await repo.findById(id);
  if (!user) throw new NotFoundError('Usuario no encontrado.');
  return user;
}

/**
 * Retorna todos los roles y equipos (para poblar los selects del form).
 */
async function getCatalogs() {
  const [roles, teams] = await Promise.all([
    repo.findAllRoles(),
    repo.findAllTeams(),
  ]);
  return { roles, teams };
}

/**
 * Longitud minima de contrasena configurada en el panel (password_min_length).
 *
 * El ajuste solo puede ENDURECER el suelo de crypto.js; el PUT del panel
 * rechaza cualquier valor por debajo, y validatePasswordStrength lo acota
 * ademas por si la fila se editara directamente en la tabla.
 */
async function configuredPasswordMinLength() {
  return settings.getInt('password_min_length', PASSWORD_MIN_LENGTH_FLOOR, {
    min: PASSWORD_MIN_LENGTH_FLOOR,
    max: 128,
  });
}

/**
 * Crea un nuevo usuario.
 */
async function createUser(data, actor) {
  const { username, email, firstName, lastName, password, roleCode, teamCode } = data;

  // Validar contraseña
  const pwdValidation = validatePasswordStrength(password, await configuredPasswordMinLength());
  if (!pwdValidation.valid) throw new ValidationError(pwdValidation.message);

  // Obtener IDs de rol y equipo
  const { roles, teams } = await getCatalogs();
  const role = roles.find(r => r.code === roleCode);
  if (!role) throw new ValidationError(`Rol '${roleCode}' no válido.`);
  assertCanAssignRole(role, actor);

  // Roles intermedios (no ADMIN ni VISITOR) requieren equipo
  if (role.level > ROLE_LEVELS.VISITOR && role.level < ROLE_LEVELS.ADMIN && !teamCode) {
    throw new ValidationError('Este rol requiere un equipo asignado.');
  }

  let teamId = null;
  if (teamCode) {
    const team = teams.find(t => t.code === teamCode);
    if (!team) throw new ValidationError(`Equipo '${teamCode}' no válido.`);
    teamId = team.id;
  }

  // Verificar unicidad de username y email
  const existing = await repo.existsByUsernameOrEmail(username, email);
  if (existing.length > 0) {
    const field = existing[0].username.toLowerCase() === username.toLowerCase()
      ? 'El username'
      : 'El email';
    throw new ValidationError(`${field} ya está en uso.`);
  }

  const passwordHash = await bcrypt.hash(password, 14);
  const newUser = await repo.create({
    username:  username.trim(),
    email:     email.trim().toLowerCase(),
    firstName: firstName.trim(),
    lastName:  lastName.trim(),
    fullName:  `${firstName.trim()} ${lastName.trim()}`.trim(),
    passwordHash,
    roleId:    role.id,
    teamId,
    createdBy: actor.id,
  });

  await auditAction({
    actorId:       actor.id,
    actorUsername: actor.username,
    action:        AUDIT_ACTIONS.USER_CREATE,
    targetId:      newUser.id,
    targetUsername: newUser.username,
    result:        RESULT.SUCCESS,
    extra:         { role: roleCode, team: teamCode || null },
    ipAddress:     actor.ip,
  });

  logger.info('Usuario creado.', { username: newUser.username, by: actor.username });
  return {
    ...newUser,
    firstName: newUser.first_name,
    lastName:  newUser.last_name,
  };
}

/**
 * Actualiza datos de un usuario.
 */
async function updateUser(id, data, actor) {
  const { email, firstName, lastName, roleCode, teamCode } = data;

  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError('Usuario no encontrado.');

  const newRoleCode = roleCode || existing.role;
  const { roles, teams } = await getCatalogs();
  const role = roles.find(r => r.code === newRoleCode);
  if (!role) throw new ValidationError(`Rol '${newRoleCode}' no válido.`);
  assertCanAssignRole(role, actor);

  // Roles intermedios (no ADMIN ni VISITOR) requieren equipo
  if (role.level > ROLE_LEVELS.VISITOR && role.level < ROLE_LEVELS.ADMIN && !teamCode) {
    throw new ValidationError('Este rol requiere un equipo asignado.');
  }

  let teamId = null;
  if (teamCode) {
    const team = teams.find(t => t.code === teamCode);
    if (!team) throw new ValidationError(`Equipo '${teamCode}' no válido.`);
    teamId = team.id;
  }

  // Si custodia credenciales, el rol y el equipo nuevos tienen que seguir
  // permitiéndole descifrarlas. Si no, quedarían sin nadie capaz de
  // abrirlas hasta que un ADMIN reasignara la custodia.
  if (role.id !== existing.role_id || teamId !== (existing.team_id || null)) {
    const grupos = await custody.custodiadasPorTipo({ query }, id);
    if (grupos.length > 0) {
      const capacidad  = await custody.capacidadPorRolYEquipo({ query }, role.id, teamId);
      const bloqueadas = grupos.filter((g) => custody.motivoSinAcceso(capacidad, g.resource_type));
      if (bloqueadas.length > 0) {
        throw new ValidationError(
          `Con ese rol o equipo, ${existing.username} no podría descifrar credenciales que custodia ` +
          `(${custody.describirCustodiadas(bloqueadas)}). Reasigna antes su custodia.`
        );
      }
    }
  }

  // No degradar al último administrador activo: dejaría el sistema sin acceso ADMIN.
  // Misma protección que toggleEstado/deleteUser, pero para el cambio de rol.
  if (existing.level >= ROLE_LEVELS.ADMIN && role.level < ROLE_LEVELS.ADMIN) {
    const { rows } = await query(
      `SELECT COUNT(*) AS total
       FROM sch_system.tbl_users u
       JOIN sch_system.tbl_roles r ON r.id = u.role_id
       WHERE r.level >= $1 AND u.estado = 'AI' AND u.estado_registro = 'O'`,
      [ROLE_LEVELS.ADMIN]
    );
    if (parseInt(rows[0].total, 10) <= 1) {
      throw new ValidationError('No puedes quitar el rol de administrador al último administrador activo del sistema.');
    }
  }

  // Verificar email único (excluyendo el propio usuario)
  if (email && email.toLowerCase() !== existing.email) {
    const dup = await repo.existsByUsernameOrEmail(existing.username, email, id);
    if (dup.length > 0) throw new ValidationError('El email ya está en uso.');
  }

  const resolvedFirstName = firstName ? firstName.trim() : existing.first_name;
  const resolvedLastName  = lastName  ? lastName.trim()  : existing.last_name;
  const resolvedFullName  = `${resolvedFirstName} ${resolvedLastName}`.trim();

  const updated = await repo.update(id, {
    email:     email ? email.trim().toLowerCase() : existing.email,
    firstName: resolvedFirstName,
    lastName:  resolvedLastName,
    fullName:  resolvedFullName,
    roleId:    role.id,
    teamId,
  });

  await auditAction({
    actorId:       actor.id,
    actorUsername: actor.username,
    action:        AUDIT_ACTIONS.USER_UPDATE,
    targetId:      id,
    targetUsername: existing.username,
    result:        RESULT.SUCCESS,
    extra:         { role: newRoleCode, team: teamCode || null },
    ipAddress:     actor.ip,
  });

  logger.info('Usuario actualizado.', { username: existing.username, by: actor.username });
  return {
    ...updated,
    firstName: updated.first_name,
    lastName:  updated.last_name,
  };
}

/**
 * Activa o desactiva un usuario.
 */
async function toggleEstado(id, actor) {
  const user = await repo.findById(id);
  if (!user) throw new NotFoundError('Usuario no encontrado.');

  // No puede desactivarse a sí mismo
  if (id === actor.id) throw new ValidationError('No puedes desactivar tu propia cuenta.');

  // No desactivar el último usuario con nivel ADMIN activo
  if (user.level >= ROLE_LEVELS.ADMIN && user.estado === 'AI') {
    const { rows } = await query(
      `SELECT COUNT(*) AS total
       FROM sch_system.tbl_users u
       JOIN sch_system.tbl_roles r ON r.id = u.role_id
       WHERE r.level >= $1
         AND u.estado = 'AI'
         AND u.estado_registro = 'O'`,
      [ROLE_LEVELS.ADMIN]
    );
    if (parseInt(rows[0].total, 10) <= 1) {
      throw new ValidationError('No puedes desactivar el último administrador activo del sistema.');
    }
  }

  // Un usuario desactivado no puede iniciar sesión: las credenciales que
  // custodia quedarían sin nadie capaz de descifrarlas. Solo al
  // desactivar; reactivar debe seguir siendo posible siempre.
  if (user.estado === 'AI') {
    await assertSinCustodias(id, user.username, 'desactivar');
  }

  const newEstado = user.estado === 'AI' ? 'IN' : 'AI';
  const updated = await repo.setEstado(id, newEstado);

  await auditAction({
    actorId:       actor.id,
    actorUsername: actor.username,
    action:        AUDIT_ACTIONS.USER_DEACTIVATE,
    targetId:      id,
    targetUsername: user.username,
    result:        RESULT.SUCCESS,
    extra:         { nuevoEstado: newEstado, sesionesRevocadas: updated?.revoked_sessions || 0 },
    ipAddress:     actor.ip,
  });

  return updated;
}

/**
 * Elimina lógicamente un usuario (soft delete).
 */
async function deleteUser(id, actor) {
  if (id === actor.id) throw new ValidationError('No puedes eliminar tu propia cuenta.');

  const user = await repo.findById(id);
  if (!user) throw new NotFoundError('Usuario no encontrado.');

  // No eliminar el último usuario con nivel ADMIN
  if (user.level >= ROLE_LEVELS.ADMIN) {
    const { rows } = await query(
      `SELECT COUNT(*) AS total
       FROM sch_system.tbl_users u
       JOIN sch_system.tbl_roles r ON r.id = u.role_id
       WHERE r.level >= $1 AND u.estado_registro = 'O'`,
      [ROLE_LEVELS.ADMIN]
    );
    if (parseInt(rows[0].total, 10) <= 1) {
      throw new ValidationError('No puedes eliminar el último administrador del sistema.');
    }
  }

  // Mismo motivo que al desactivar.
  await assertSinCustodias(id, user.username, 'eliminar');

  await repo.softDelete(id);

  await auditAction({
    actorId:       actor.id,
    actorUsername: actor.username,
    action:        AUDIT_ACTIONS.USER_DEACTIVATE,
    targetId:      id,
    targetUsername: user.username,
    result:        RESULT.SUCCESS,
    extra:         { tipo: 'eliminacion_logica' },
    ipAddress:     actor.ip,
  });

  logger.info('Usuario eliminado lógicamente.', { username: user.username, by: actor.username });
  return { success: true };
}

/**
 * Resetea la contraseña de un usuario (el usuario deberá cambiarla en el siguiente login).
 */
async function resetPassword(id, newPassword, actor) {
  const user = await repo.findById(id);
  if (!user) throw new NotFoundError('Usuario no encontrado.');

  const pwdValidation = validatePasswordStrength(newPassword, await configuredPasswordMinLength());
  if (!pwdValidation.valid) throw new ValidationError(pwdValidation.message);

  const passwordHash = await bcrypt.hash(newPassword, 14);
  await repo.updatePasswordHash(id, passwordHash);

  await auditAction({
    actorId:       actor.id,
    actorUsername: actor.username,
    action:        AUDIT_ACTIONS.USER_UPDATE,
    targetId:      id,
    targetUsername: user.username,
    result:        RESULT.SUCCESS,
    extra:         { tipo: 'reset_password' },
    ipAddress:     actor.ip,
  });

  logger.info('Contraseña reseteada.', { username: user.username, by: actor.username });
  return { success: true };
}

/**
 * Desbloquea una cuenta bloqueada.
 */
async function unlockAccount(id, actor) {
  const user = await repo.findById(id);
  if (!user) throw new NotFoundError('Usuario no encontrado.');
  await repo.unlockAccount(id);

  await auditAction({
    actorId:        actor.id,
    actorUsername:  actor.username,
    action:         AUDIT_ACTIONS.ACCOUNT_UNLOCKED,
    targetId:       id,
    targetUsername: user.username,
    result:         RESULT.SUCCESS,
    extra:          { intentosPrevios: user.failed_attempts, bloqueadaHasta: user.locked_until },
    ipAddress:      actor.ip,
  });

  logger.info('Cuenta desbloqueada.', { username: user.username, by: actor.username });
  return { success: true };
}

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
// Nadie puede asignar un rol de nivel superior al suyo.
//
// Defensa en profundidad: las rutas del módulo ya exigen nivel ADMIN, así que
// hoy esto no se dispara. Queda por si el permiso MOD_USERS llega alguna vez a
// un rol intermedio: sin esta comprobación, ese rol podría fabricarse un ADMIN.
//
// Se compara con ">" y no con ">=" a propósito: un ADMIN debe poder crear y
// editar a otro ADMIN de su mismo nivel.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Un usuario que custodia credenciales no se puede desactivar ni eliminar.
//
// Un custodio inactivo no inicia sesión, y una credencial custodiada solo la
// descifra su custodio: quedaba sin nadie capaz de abrirla hasta que un ADMIN
// reasignara la custodia. Mismo criterio que desactivar un rol o un equipo con
// usuarios asignados (AU3): se niega la acción y se dice qué resolver antes.
// ---------------------------------------------------------------------------
async function assertSinCustodias(userId, username, accion) {
  const grupos = await custody.custodiadasPorTipo({ query }, userId);
  if (grupos.length > 0) {
    throw new ValidationError(
      `No puedes ${accion} a ${username}: custodia credenciales ` +
      `(${custody.describirCustodiadas(grupos)}). Reasigna antes su custodia.`
    );
  }
}

function assertCanAssignRole(role, actor) {
  if (role.level > (actor.level || 0)) {
    throw new ForbiddenError('No puedes asignar un rol de nivel superior al tuyo.');
  }
}

module.exports = {
  listUsers,
  getUser,
  getCatalogs,
  createUser,
  updateUser,
  toggleEstado,
  deleteUser,
  resetPassword,
  unlockAccount,
  ValidationError,
  NotFoundError,
  ForbiddenError,
};
