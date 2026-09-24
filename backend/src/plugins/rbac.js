'use strict';

const { ROLE_LEVELS } = require('../config/constants');
const logger = require('../utils/logger');

// =============================================================================
// plugins/rbac.js — Control de acceso por permisos, nivel de rol y ámbito.
//
// Cada función devuelve un pre-handler de hapi que se coloca en `options.pre`
// de la ruta, en el mismo orden en que antes se encadenaban los middlewares.
//
// ORDEN OBLIGATORIO DE VALIDACIÓN:
//   1. Autenticación (auth: 'session')     — ¿está autenticado?
//   2. Permiso (requirePermission)         — ¿tiene el permiso requerido?
//   3. Ámbito de equipo (requireTeamScope) — ¿puede acceder a este tipo de recurso?
//   4. Custodia (en credentialsService)    — ¿es el custodio asignado?
//
// requireMinLevel se mantiene para protección de rutas exclusivas de ADMIN
// (gestión de usuarios, catálogos, seguridad, sistema) donde se requiere
// comprobar el nivel jerárquico además del permiso.
//
// requirePermission usa request.auth.credentials.permissions[], cargado por el
// esquema de autenticación desde tbl_role_permissions. Los cambios de permisos
// se reflejan en el siguiente request sin necesidad de re-login.
// =============================================================================

/** URL completa para los logs (equivalente a req.originalUrl). */
function urlOf(request) {
  return request.url.pathname + (request.url.search || '');
}

function unauthorized(h) {
  return h.response({
    success: false,
    code: 'UNAUTHORIZED',
    message: 'Autenticación requerida.',
  }).code(401).takeover();
}

function forbidden(h, message) {
  return h.response({
    success: false,
    code: 'FORBIDDEN',
    message,
  }).code(403).takeover();
}

/**
 * Pre-handler: verifica que el usuario tenga un nivel de rol >= minLevel.
 *
 * @param {number} minLevel - Nivel mínimo requerido (ver ROLE_LEVELS en constants.js).
 * @returns {function} Pre-handler de hapi.
 *
 * @example
 *   // Solo roles con level >= 100 (ADMIN y cualquier rol custom de nivel alto)
 *   options: { auth: 'session', pre: [requireMinLevel(ROLE_LEVELS.ADMIN)] }
 */
function requireMinLevel(minLevel) {
  return (request, h) => {
    const user = request.auth.credentials;
    if (!user) return unauthorized(h);

    if (user.level < minLevel) {
      logger.warn('Acceso denegado por nivel de rol insuficiente.', {
        user:          user.username,
        userLevel:     user.level,
        requiredLevel: minLevel,
        url:           urlOf(request),
      });
      return forbidden(h, 'No tienes permisos para realizar esta acción.');
    }

    return h.continue;
  };
}

/**
 * Pre-handler: verifica que el usuario pueda acceder al tipo de recurso indicado.
 *
 * Reglas de separación de responsabilidades:
 *   - Nivel ADMIN (level >= 100): bypass total — accede a DB, OS, APP y NET sin restricción.
 *   - Nivel VISITOR (level <= 0): sin acceso a ningún recurso.
 *   - Resto: el equipo del usuario debe incluir el resource_type requerido en su lista.
 *     Un equipo puede tener múltiples tipos (junction table tbl_team_resource_types).
 *
 * @param {'DB'|'OS'|'APP'|'NET'} resourceType - Tipo de recurso del endpoint.
 * @returns {function} Pre-handler de hapi.
 */
function requireTeamScope(resourceType) {
  return (request, h) => {
    const user = request.auth.credentials;
    if (!user) return unauthorized(h);

    // Nivel ADMIN: bypass de la separación de responsabilidades.
    if (user.level >= ROLE_LEVELS.ADMIN) return h.continue;

    // Nivel VISITOR (0) o sin equipo asignado: sin acceso a recursos.
    const teamTypes = user.teamResourceTypes || [];
    if (user.level <= ROLE_LEVELS.VISITOR || teamTypes.length === 0) {
      return forbidden(h, 'Tu rol no tiene acceso a credenciales ni recursos.');
    }

    // Verificar que el equipo del usuario incluya el tipo de recurso requerido
    if (!teamTypes.includes(resourceType)) {
      logger.warn('Acceso cruzado denegado por ámbito de equipo.', {
        user:              user.username,
        teamResourceTypes: teamTypes,
        requiredType:      resourceType,
        url:               urlOf(request),
      });
      return forbidden(h, `Tu equipo no tiene acceso a recursos de tipo ${resourceType}.`);
    }

    return h.continue;
  };
}

/**
 * Pre-handler: verifica que el usuario tenga el permiso indicado.
 *
 * Los permisos se cargan en request.auth.credentials.permissions[] por el
 * esquema de autenticación en cada request (sin caché — refleja cambios
 * inmediatamente).
 *
 * @param {string} permissionCode - Código del permiso (ver PERMISSIONS en constants.js).
 * @returns {function} Pre-handler de hapi.
 */
function requirePermission(permissionCode) {
  return (request, h) => {
    const user = request.auth.credentials;
    if (!user) return unauthorized(h);

    const permissions = user.permissions || [];
    if (!permissions.includes(permissionCode)) {
      logger.warn('Acceso denegado por permiso insuficiente.', {
        user:       user.username,
        permission: permissionCode,
        url:        urlOf(request),
      });
      return forbidden(h, 'No tienes permisos para realizar esta acción.');
    }

    return h.continue;
  };
}

module.exports = {
  requireMinLevel,
  requirePermission,
  requireTeamScope,
};
