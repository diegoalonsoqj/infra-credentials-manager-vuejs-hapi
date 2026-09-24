'use strict';

const { ROLE_LEVELS } = require('../config/constants');

// =============================================================================
// teamAccess.js — Nivel de acceso del equipo sobre cada tipo de recurso
// (migración 022).
//
//   FULL  ver y modificar todo lo de ese tipo (el comportamiento de siempre).
//   READ  "Consulta": ver todo lo de ese tipo, pero modificar solo lo que
//         pertenece al propio equipo (owner_team_id). Crear sí: lo creado pasa
//         a ser del equipo. Descifrar una credencial de OTRO equipo exige un
//         motivo, que queda en la auditoría.
//
// El permiso del rol se sigue exigiendo aparte (CRED_EDIT, RES_EDIT…): este
// nivel solo puede recortar lo que el rol permite, nunca ampliarlo.
//
// El actor debe traer level, teamId y readOnlyTypes (plugins/auth.js los carga
// en cada petición desde la sesión).
// =============================================================================

class ForbiddenError extends Error {
  constructor(msg) { super(msg); this.name = 'ForbiddenError'; this.isForbidden = true; }
}

const TYPE_NAMES = { DB: 'bases de datos', OS: 'servidores', APP: 'aplicaciones', NET: 'dispositivos de red' };

/** El equipo del actor solo tiene acceso de consulta a ese tipo. ADMIN nunca. */
function isReadOnly(actor, type) {
  return (actor.level || 0) < ROLE_LEVELS.ADMIN && (actor.readOnlyTypes || []).includes(type);
}

/** Pertenece al equipo del actor. NULL (ADMIN o anterior a 022) no es de nadie. */
function ownsIt(actor, ownerTeamId) {
  return actor.teamId != null && ownerTeamId != null && Number(ownerTeamId) === Number(actor.teamId);
}

function canModify(actor, type, ownerTeamId) {
  return !isReadOnly(actor, type) || ownsIt(actor, ownerTeamId);
}

/** Lanza 403 si el actor solo tiene consulta sobre el tipo y no es de su equipo. */
function assertCanModify(actor, type, ownerTeamId) {
  if (!canModify(actor, type, ownerTeamId)) {
    throw new ForbiddenError(
      `Tu equipo tiene acceso de consulta a ${TYPE_NAMES[type] || type}: ` +
      'solo puedes modificar lo que pertenece a tu equipo.'
    );
  }
}

/** Descifrar una credencial de otro equipo con acceso de consulta pide motivo. */
function needsDecryptReason(actor, cred) {
  return isReadOnly(actor, cred.resource_type) && !ownsIt(actor, cred.owner_team_id);
}

/** Equipo propietario de lo que crea el actor. ADMIN no tiene equipo: NULL. */
function ownerTeamFor(actor) {
  if ((actor.level || 0) >= ROLE_LEVELS.ADMIN) return null;
  return actor.teamId || null;
}

/** Campos de acceso de equipo del actor, a partir de las credenciales de sesión. */
function actorAccess(user) {
  return {
    level:         user.level,
    teamId:        user.teamId ?? null,
    readOnlyTypes: user.teamReadOnlyTypes || [],
  };
}

module.exports = {
  isReadOnly, ownsIt, canModify, assertCanModify, needsDecryptReason, ownerTeamFor, actorAccess,
  ForbiddenError,
};
