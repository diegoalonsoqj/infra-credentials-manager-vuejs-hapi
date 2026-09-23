'use strict';

const { Joi, M, uuidParam, normalizedEmail, searchQuery, paginationQuery } = require('../validation');
const { clientIp } = require('../utils/clientIp');
const svc = require('../services/users.service');
const usersRepo = require('../repositories/users.repository');
const mfaService = require('../services/mfa.service');

// =============================================================================
// users.controller.js — Handlers HTTP para administración de usuarios.
// Todos los endpoints requieren el permiso MOD_USERS (enforced en rutas).
// =============================================================================

// Valida que :id sea un UUID válido antes de llegar al servicio.
// Previene errores de tipo PostgreSQL (invalid input syntax for type uuid) al pasar strings basura.
const userIdParam = uuidParam('ID de usuario inválido.');

function buildActor(request) {
  const user = request.auth.credentials;
  // level lo usa assertCanAssignRole en el servicio.
  return { id: user.id, username: user.username, level: user.level, ip: clientIp(request) };
}

/**
 * Traduce los errores de negocio del servicio a respuestas HTTP.
 * Cualquier otro error se propaga al manejador global (plugins/errors.js).
 */
function handleServiceError(err, h) {
  if (err.isValidation) return h.response({ success: false, code: 'VALIDATION_ERROR', message: err.message }).code(400);
  if (err.isNotFound)   return h.response({ success: false, code: 'NOT_FOUND',        message: err.message }).code(404);
  if (err.isForbidden)  return h.response({ success: false, code: 'FORBIDDEN',        message: err.message }).code(403);
  throw err;
}

// ---------------------------------------------------------------------------
// GET /api/admin/users
// ---------------------------------------------------------------------------
// Se declaran todos los parámetros que envía la pantalla de usuarios. Antes solo
// `search`, y el resto pasaba sin mirar por allowUnknown.
const listQuerySchema = Joi.object({
  ...paginationQuery,
  search:   searchQuery,
  roleCode: Joi.string().trim().max(50).allow('').messages(M('roleCode no es válido.')),
  teamCode: Joi.string().trim().max(50).allow('').messages(M('teamCode no es válido.')),
  estado:   Joi.string().valid('AI', 'IN').allow('').messages(M('estado debe ser AI o IN.')),
});

// Equipo de un usuario. Los roles intermedios lo exigen (users.service.js). No
// estaba declarado en el alta ni en la edición y llegaba sin validar; con el
// esquema estricto, sin este campo se rechazaría todo usuario con equipo.
const teamCodeField = Joi.string().trim().max(50).allow('', null).optional()
  .messages(M('El equipo no es válido.'));

async function listUsers(request) {
  const q = request.query;

  const page     = Math.max(1, Math.min((parseInt(q.page,  10) || 1),  10000));
  const limit    = Math.max(1, (parseInt(q.limit, 10) || 20));
  const search   = q.search   || '';
  const roleCode = q.roleCode || null;
  const teamCode = q.teamCode || null;
  const estado   = q.estado   || null;

  const result = await svc.listUsers({ page, limit: Math.min(limit, 100), search, roleCode, teamCode, estado });
  return { success: true, ...result };
}

// ---------------------------------------------------------------------------
// GET /api/admin/users/catalogs
// ---------------------------------------------------------------------------
async function getCatalogs() {
  const catalogs = await svc.getCatalogs();
  return { success: true, ...catalogs };
}

// ---------------------------------------------------------------------------
// GET /api/admin/users/:id
// ---------------------------------------------------------------------------
async function getUser(request, h) {
  try {
    const user = await svc.getUser(request.params.id);
    return { success: true, user };
  } catch (err) { return handleServiceError(err, h); }
}

// ---------------------------------------------------------------------------
// POST /api/admin/users
// ---------------------------------------------------------------------------
// Origen de la contraseña: LOCAL (bcrypt en ICM) o LDAP (dominio).
const authSourceField = Joi.string().valid('LOCAL', 'LDAP')
  .messages(M('El origen de autenticación debe ser LOCAL o LDAP.'));

const createSchema = Joi.object({
  // En un usuario LDAP es su nombre en el dominio (sAMAccountName).
  username: Joi.string().trim().min(3).max(50).pattern(/^[a-zA-Z0-9._-]+$/).required()
    .messages(M('Username: 3-50 chars, letras, números, punto, guion o guion bajo.')),
  email: normalizedEmail.required().messages(M('Email inválido.')),
  firstName: Joi.string().trim().min(1).required().messages(M('El nombre es obligatorio.')),
  lastName:  Joi.string().trim().min(1).required().messages(M('El apellido es obligatorio.')),
  authSource: authSourceField.default('LOCAL'),
  // Un usuario LDAP no tiene contraseña en ICM: si llega, se descarta.
  password:  Joi.when('authSource', {
    is: 'LDAP',
    then: Joi.any().strip(),
    otherwise: Joi.string().min(12).required().messages(M('Contraseña: mínimo 12 caracteres.')),
  }),
  roleCode:  Joi.string().min(1).required().messages(M('El rol es requerido.')),
  teamCode:  teamCodeField,
  // UserForm.vue envía el mismo formulario al crear y al editar; esta solo se
  // usa al editar (paso de LDAP a local).
  newPassword: Joi.any().strip(),
});

async function createUser(request, h) {
  try {
    const user = await svc.createUser(request.payload, buildActor(request));
    return h.response({ success: true, user }).code(201);
  } catch (err) { return handleServiceError(err, h); }
}

// ---------------------------------------------------------------------------
// PUT /api/admin/users/:id
// ---------------------------------------------------------------------------
const updateSchema = Joi.object({
  email:     normalizedEmail.optional().messages(M('Email inválido.')),
  firstName: Joi.string().trim().min(1).optional().messages(M('El nombre es obligatorio.')),
  lastName:  Joi.string().trim().min(1).optional().messages(M('El apellido es obligatorio.')),
  roleCode:  Joi.string().min(1).optional().messages(M('El rol es requerido.')),
  teamCode:  teamCodeField,
  authSource: authSourceField.optional(),
  // Contraseña temporal, solo al pasar un usuario de LDAP a LOCAL.
  newPassword: Joi.string().min(12).allow('').optional().messages(M('Contraseña: mínimo 12 caracteres.')),
  // UserForm.vue reenvía el formulario completo al editar. El username no se
  // puede cambiar y la contraseña va por /reset-password: se aceptan y se
  // descartan, igual que hacía el servicio al no leerlos.
  username:  Joi.any().strip(),
  password:  Joi.any().strip(),
});

async function updateUser(request, h) {
  try {
    const user = await svc.updateUser(request.params.id, request.payload, buildActor(request));
    return { success: true, user };
  } catch (err) { return handleServiceError(err, h); }
}

// ---------------------------------------------------------------------------
// PATCH /api/admin/users/:id/toggle-estado
// ---------------------------------------------------------------------------
async function toggleEstado(request, h) {
  try {
    const user = await svc.toggleEstado(request.params.id, buildActor(request));
    return { success: true, user };
  } catch (err) { return handleServiceError(err, h); }
}

// ---------------------------------------------------------------------------
// DELETE /api/admin/users/:id
// ---------------------------------------------------------------------------
async function deleteUser(request, h) {
  try {
    await svc.deleteUser(request.params.id, buildActor(request));
    return { success: true, message: 'Usuario eliminado.' };
  } catch (err) { return handleServiceError(err, h); }
}

// ---------------------------------------------------------------------------
// POST /api/admin/users/:id/reset-password
// ---------------------------------------------------------------------------
const resetPasswordSchema = Joi.object({
  newPassword: Joi.string().min(12).required().messages(M('Mínimo 12 caracteres.')),
});

async function resetPassword(request, h) {
  try {
    await svc.resetPassword(request.params.id, request.payload.newPassword, buildActor(request));
    return { success: true, message: 'Contraseña reseteada. El usuario deberá cambiarla en el próximo login.' };
  } catch (err) { return handleServiceError(err, h); }
}

// ---------------------------------------------------------------------------
// POST /api/admin/users/:id/unlock
// ---------------------------------------------------------------------------
async function unlockAccount(request, h) {
  try {
    await svc.unlockAccount(request.params.id, buildActor(request));
    return { success: true, message: 'Cuenta desbloqueada.' };
  } catch (err) { return handleServiceError(err, h); }
}

/**
 * POST /api/admin/users/{id}/mfa/reset — el usuario perdió el móvil y los
 * códigos de recuperación. Quita su segundo factor y cierra sus sesiones.
 */
async function resetMfa(request, h) {
  try {
    const target = await usersRepo.findById(request.params.id);
    if (!target) return h.response({ success: false, code: 'NOT_FOUND', message: 'Usuario no encontrado.' }).code(404);
    const r = await mfaService.adminReset({ id: target.id, username: target.username }, buildActor(request));
    return { success: true, ...r, message: 'Segundo factor restablecido. El usuario deberá volver a activarlo.' };
  } catch (err) { return handleServiceError(err, h); }
}

module.exports = {
  resetMfa,
  listUsers, listQuerySchema, getCatalogs, getUser,
  createUser, createSchema,
  updateUser, updateSchema,
  toggleEstado, deleteUser,
  resetPassword, resetPasswordSchema,
  unlockAccount,
  userIdParam,
};
