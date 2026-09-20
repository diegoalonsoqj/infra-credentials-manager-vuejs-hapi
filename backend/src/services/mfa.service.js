'use strict';

const crypto  = require('crypto');
const bcrypt  = require('bcryptjs');
const repo    = require('../repositories/mfa.repository');
const totp    = require('../utils/totp');
const settings = require('../config/settings');
const { query } = require('../config/database');
const { AUDIT_ACTIONS, RESULT, ROLE_LEVELS } = require('../config/constants');
const logger  = require('../utils/logger');

// =============================================================================
// mfa.service.js — Segundo factor de autenticación (TOTP).
//
// Flujo:
//   1. beginSetup: genera un secreto y lo guarda cifrado, aún sin activar.
//   2. confirmSetup: el primer código de la aplicación (Aegis…) lo activa y
//      devuelve los códigos de recuperación, que solo se muestran esa vez.
//   3. verifyCode: segundo paso del login. Acepta un código TOTP (una sola vez
//      por paso de 30 s) o un código de recuperación (una sola vez).
//
// La política (ajuste mfa_policy) decide quién está obligado. Quien lo está y
// no lo tiene activado solo puede activarlo (plugins/mfaGuard.js), y no puede
// desactivarlo.
// =============================================================================

const POLICIES = ['none', 'admins', 'all'];
const DEFAULT_POLICY = 'all';
const ISSUER = 'ICM';
const RECOVERY_CODES = 10;

class ValidationError extends Error {
  constructor(msg) { super(msg); this.name = 'ValidationError'; this.isValidation = true; }
}
class ForbiddenError extends Error {
  constructor(msg) { super(msg); this.name = 'ForbiddenError'; this.isForbidden = true; }
}

async function audit({ actor, action, result = RESULT.SUCCESS, target, failReason, extra }) {
  try {
    await query(
      `INSERT INTO sch_audit.tbl_audit_log
         (user_id, username, action, resource_type, resource_id, resource_name, result, fail_reason, ip_address, extra_data)
       VALUES ($1, $2, $3, 'SYS', $4, $5, $6, $7, $8, $9)`,
      [actor.id, actor.username, action, target ? String(target.id) : null, target ? target.username : null,
       result, failReason || null, actor.ip || null, JSON.stringify(extra || {})]
    );
  } catch (err) {
    logger.error('Error en auditoría del segundo factor:', { code: err.code, action });
  }
}

/** ¿La política obliga a este nivel de rol a usar segundo factor? */
async function isRequired(level) {
  const policy = await settings.getString('mfa_policy', DEFAULT_POLICY, POLICIES);
  return policy === 'all' || (policy === 'admins' && level >= ROLE_LEVELS.ADMIN);
}

async function status(user) {
  const state = await repo.getState(user.id);
  return {
    enabled:       !!(state && state.mfa_enabled),
    required:      await isRequired(user.level),
    recoveryCodesLeft: state && state.mfa_enabled ? state.recovery_left : 0,
  };
}

// Códigos de recuperación: 10 caracteres base32 (50 bits), en dos grupos.
function newRecoveryCodes() {
  return Array.from({ length: RECOVERY_CODES }, () => {
    const c = totp.base32Encode(crypto.randomBytes(7)).slice(0, 10);
    return `${c.slice(0, 5)}-${c.slice(5)}`;
  });
}
const normalizeRecovery = (code) => String(code || '').toUpperCase().replace(/[\s-]/g, '');
const hashRecovery = (code) => crypto.createHash('sha256').update(normalizeRecovery(code)).digest('hex');

async function beginSetup(user) {
  const state = await repo.getState(user.id);
  if (!state) throw new ValidationError('Usuario no encontrado.');
  if (state.mfa_enabled) throw new ValidationError('El segundo factor ya está activado.');
  const secret = totp.generateSecret();
  if (!(await repo.savePendingSecret(user.id, secret))) throw new ValidationError('No se pudo iniciar la activación.');
  return { secret, otpauthUri: totp.otpauthUri({ issuer: ISSUER, account: user.username, secret }) };
}

async function confirmSetup(user, code) {
  const state = await repo.getState(user.id);
  if (state && state.mfa_enabled) throw new ValidationError('El segundo factor ya está activado.');
  const secret = await repo.getSecret(user.id);
  if (!secret) throw new ValidationError('Primero inicia la activación para obtener el código QR.');
  const step = totp.verify(secret, code);
  if (step === null) throw new ValidationError('El código no es correcto. Comprueba la hora del móvil y vuelve a intentarlo.');
  const codes = newRecoveryCodes();
  if (!(await repo.enable(user.id, step, codes.map(hashRecovery)))) {
    throw new ValidationError('No se pudo activar: el código ya se usó o la activación cambió. Vuelve a intentarlo.');
  }
  await audit({ actor: user, action: AUDIT_ACTIONS.MFA_ENABLED });
  logger.info('Segundo factor activado.', { username: user.username });
  return { recoveryCodes: codes };
}

/**
 * Comprueba un código del segundo paso: TOTP de 6 dígitos o código de
 * recuperación. Cada uno vale una sola vez.
 *
 * @returns {Promise<{ok: boolean, method?: 'totp'|'recovery'}>}
 */
async function verifyCode(userId, code) {
  const raw = String(code || '').trim();
  if (/^\d{6}$/.test(raw)) {
    const secret = await repo.getSecret(userId);
    const step = secret ? totp.verify(secret, raw) : null;
    if (step !== null && await repo.consumeStep(userId, step)) return { ok: true, method: 'totp' };
    return { ok: false };
  }
  if (normalizeRecovery(raw).length === 10 && await repo.consumeRecoveryCode(userId, hashRecovery(raw))) {
    return { ok: true, method: 'recovery' };
  }
  return { ok: false };
}

// Desactivar o regenerar exige contraseña y un código: una sesión robada no basta.
async function reauth(user, { password, code }) {
  const state = await repo.getState(user.id);
  if (!state || !state.mfa_enabled) throw new ValidationError('El segundo factor no está activado.');
  const passOk = await bcrypt.compare(String(password || ''), state.password_hash);
  const codeOk = passOk ? (await verifyCode(user.id, code)).ok : false;
  if (!passOk || !codeOk) throw new ValidationError('Contraseña o código incorrectos.');
}

async function disable(user, creds) {
  if (await isRequired(user.level)) {
    throw new ForbiddenError('La política del sistema exige segundo factor para tu cuenta: no se puede desactivar.');
  }
  await reauth(user, creds);
  await repo.disable(user.id);
  await audit({ actor: user, action: AUDIT_ACTIONS.MFA_DISABLED });
  return { enabled: false };
}

async function regenerateRecoveryCodes(user, creds) {
  await reauth(user, creds);
  const codes = newRecoveryCodes();
  await repo.replaceRecoveryCodes(user.id, codes.map(hashRecovery));
  await audit({ actor: user, action: AUDIT_ACTIONS.MFA_RECOVERY_CODES_REGENERATED });
  return { recoveryCodes: codes };
}

/**
 * Restablecimiento por un ADMIN (el usuario perdió el móvil y los códigos).
 * Cierra sus sesiones: si está obligado, en su siguiente acceso solo podrá
 * volver a activarlo. No se permite sobre la propia cuenta: para eso está el
 * perfil, que pide contraseña y código.
 */
async function adminReset(target, actor) {
  if (target.id === actor.id) throw new ValidationError('No puedes restablecer tu propio segundo factor desde aquí; usa tu perfil.');
  const { updated, revoked } = await repo.disable(target.id, { revokeSessions: true });
  if (!updated) throw new ValidationError('Usuario no encontrado.');
  await audit({ actor, action: AUDIT_ACTIONS.MFA_RESET, target, extra: { revokedSessions: revoked } });
  logger.warn('Segundo factor restablecido por un administrador.', { target: target.username, by: actor.username });
  return { reset: true, revokedSessions: revoked };
}

module.exports = {
  POLICIES, DEFAULT_POLICY, isRequired, status, beginSetup, confirmSetup, verifyCode,
  disable, regenerateRecoveryCodes, adminReset, hashRecovery, normalizeRecovery,
  ValidationError, ForbiddenError,
};
