'use strict';

const { Joi, M, uuidParam, searchQuery, paginationQuery } = require('../validation');
const { clientIp } = require('../utils/clientIp');
const svc = require('../services/credentials.service');

// =============================================================================
// credentials.controller.js — Handlers HTTP para gestión de credenciales.
//
// La contraseña NUNCA se loguea ni se devuelve fuera del endpoint decrypt.
// La validación de RBAC y custodia ocurre en el servicio, no aquí.
// =============================================================================

// Valida que :id sea un UUID válido antes de llegar al servicio.
// Previene errores PG 22P02 (invalid input syntax for type uuid) que generan 500s.
const credentialIdParam = uuidParam('ID de credencial inválido.');

function buildActor(request) {
  const user = request.auth.credentials;
  return {
    id:                user.id,
    username:          user.username,
    ip:                clientIp(request),
    role:              user.role,
    team:              user.team,
    level:             user.level,
    teamResourceTypes: user.teamResourceTypes || [],
  };
}

/**
 * Traduce los errores de negocio del servicio a respuestas HTTP.
 * Cualquier otro error se propaga al manejador global (plugins/errors.js).
 */
function handleServiceError(err, h) {
  if (err.isValidation) return h.response({ success: false, code: 'VALIDATION_ERROR', message: err.message }).code(400);
  if (err.isNotFound)   return h.response({ success: false, code: 'NOT_FOUND',        message: err.message }).code(404);
  if (err.isForbidden)  return h.response({ success: false, code: 'FORBIDDEN',        message: err.message }).code(403);
  // Rotacion de Master Key en curso: no se escribio nada y se puede reintentar.
  if (err.isKeyUnavailable) {
    return h.response({ success: false, code: 'MASTER_KEY_ROTATING', message: err.message }).code(503);
  }
  throw err;
}

// ---------------------------------------------------------------------------
// GET /api/credentials/catalogs
// ---------------------------------------------------------------------------
async function getCatalogs(request) {
  const catalogs = await svc.getCatalogs(buildActor(request));
  return { success: true, ...catalogs };
}

// ---------------------------------------------------------------------------
// GET /api/credentials
// ---------------------------------------------------------------------------
// Los filtros admiten cadena vacía (el frontend envía el filtro sin valor
// cuando está "sin seleccionar"), igual que las comprobaciones manuales previas.
// page y limit se declaran con el resto: con el esquema estricto, lo que no
// figura aquí se rechaza.
const listQuerySchema = Joi.object({
  ...paginationQuery,
  search: searchQuery,
  environmentId: Joi.number().integer().min(1).allow('')
    .messages(M('environmentId debe ser un entero positivo.')),
  resourceType: Joi.string().valid('DB', 'OS', 'APP', 'NET').allow('')
    .messages(M('resourceType debe ser DB, OS, APP o NET.')),
  custodied: Joi.string().valid('true', 'false')
    .messages(M('custodied debe ser true o false.')),
  estado: Joi.string().valid('AI', 'IN').allow('')
    .messages(M('estado debe ser AI o IN.')),
});

async function listCredentials(request) {
  const q = request.query;

  const page   = Math.max(1, Math.min((parseInt(q.page,  10) || 1),  10000));
  const limit  = Math.max(1, (parseInt(q.limit, 10) || 20));
  const search = q.search || '';

  const environmentId      = q.environmentId ? parseInt(q.environmentId, 10) : null;
  const filterResourceType = q.resourceType || null;
  const custodied          = q.custodied === 'true' ? true : q.custodied === 'false' ? false : null;
  const estado             = q.estado || null;

  const result = await svc.listCredentials(
    { page, limit: Math.min(limit, 100), search, environmentId, filterResourceType, custodied, estado },
    buildActor(request)
  );
  return { success: true, ...result };
}

// ---------------------------------------------------------------------------
// GET /api/credentials/:id
// ---------------------------------------------------------------------------
async function getCredential(request, h) {
  try {
    const cred = await svc.getCredential(request.params.id, buildActor(request));
    return { success: true, credential: cred };
  } catch (err) { return handleServiceError(err, h); }
}

// ---------------------------------------------------------------------------
// POST /api/credentials/:id/decrypt
// ---------------------------------------------------------------------------
async function decryptPassword(request, h) {
  try {
    const result = await svc.decryptPassword(request.params.id, buildActor(request));
    return { success: true, ...result };
  } catch (err) { return handleServiceError(err, h); }
}

// ---------------------------------------------------------------------------
// POST /api/credentials
// ---------------------------------------------------------------------------
const createSchema = Joi.object({
  instanceId: Joi.number().integer().min(1).required()
    .messages(M('La instancia es obligatoria.')),
  resourceType: Joi.string().valid('DB', 'OS', 'APP', 'NET').allow('', null).optional()
    .messages(M('Tipo de recurso debe ser DB, OS, APP o NET.')),
  username: Joi.string().trim().max(200).required()
    .messages(M('El username es obligatorio.')),
  password: Joi.string().max(1000).required()
    .messages(M('La contraseña es obligatoria y no puede superar 1000 caracteres.')),
  description: Joi.string().max(500).allow('', null).optional()
    .messages(M('La descripción no puede superar 500 caracteres.')),
  notes: Joi.string().max(2000).allow('', null).optional()
    .messages(M('Las notas no pueden superar 2000 caracteres.')),
  // El servicio ya trataba estos dos campos, pero no estaban declarados y
  // llegaban sin validar (VALIDATION_OPTIONS usa allowUnknown). Se admite ''
  // porque el formulario del frontend envia el objeto completo aunque no se
  // marque la custodia.
  isCustodied: Joi.boolean().optional()
    .messages(M('isCustodied debe ser verdadero o falso.')),
  custodianUserId: Joi.string().uuid().allow('', null).optional()
    .messages(M('El custodio debe ser un UUID válido.')),
});

async function createCredential(request, h) {
  try {
    const cred = await svc.createCredential(request.payload, buildActor(request));
    return h.response({ success: true, credential: cred }).code(201);
  } catch (err) { return handleServiceError(err, h); }
}

// ---------------------------------------------------------------------------
// PUT /api/credentials/:id
// ---------------------------------------------------------------------------
const updateSchema = Joi.object({
  username: Joi.string().trim().max(200).required()
    .messages(M('El username es obligatorio.')),
  description: Joi.string().max(500).allow('', null).optional()
    .messages(M('La descripción no puede superar 500 caracteres.')),
  notes: Joi.string().max(2000).allow('', null).optional()
    .messages(M('Las notas no pueden superar 2000 caracteres.')),
  // Sin .trim(): con convert activo Joi MODIFICA el valor, y un secreto con
  // espacios al principio o al final se cifraba recortado, distinto del real.
  // La cadena vacia significa "no cambiar la contraseña": es lo que envia el
  // formulario de edicion cuando el campo opcional se deja en blanco, y antes
  // se rechazaba con un 400, de modo que no se podia editar nada sin cambiarla.
  newPassword: Joi.string().max(1000).allow('', null).optional()
    .messages(M('La nueva contraseña no puede superar 1000 caracteres.')),
});

async function updateCredential(request, h) {
  try {
    const cred = await svc.updateCredential(request.params.id, request.payload, buildActor(request));
    return { success: true, credential: cred };
  } catch (err) { return handleServiceError(err, h); }
}

// ---------------------------------------------------------------------------
// PATCH /api/credentials/:id/toggle-estado
// ---------------------------------------------------------------------------
async function toggleEstado(request, h) {
  try {
    const cred = await svc.toggleEstado(request.params.id, buildActor(request));
    return { success: true, credential: cred };
  } catch (err) { return handleServiceError(err, h); }
}

// ---------------------------------------------------------------------------
// PATCH /api/credentials/:id/custodian  — solo ADMIN
// ---------------------------------------------------------------------------
const reassignCustodianSchema = Joi.object({
  newCustodianUserId: Joi.string().uuid().required()
    .messages(M('El ID del nuevo custodio debe ser un UUID válido.')),
});

async function reassignCustodian(request, h) {
  try {
    const { newCustodianUserId } = request.payload;
    const cred = await svc.reassignCustodian(request.params.id, newCustodianUserId, buildActor(request));
    return { success: true, credential: cred };
  } catch (err) { return handleServiceError(err, h); }
}

// ---------------------------------------------------------------------------
// DELETE /api/credentials/:id
// ---------------------------------------------------------------------------
async function deleteCredential(request, h) {
  try {
    await svc.deleteCredential(request.params.id, buildActor(request));
    return { success: true, message: 'Credencial eliminada.' };
  } catch (err) { return handleServiceError(err, h); }
}

module.exports = {
  getCatalogs,
  listCredentials, listQuerySchema,
  getCredential,
  decryptPassword,
  createCredential, createSchema,
  updateCredential, updateSchema,
  toggleEstado,
  deleteCredential,
  reassignCustodian, reassignCustodianSchema,
  credentialIdParam,
};
