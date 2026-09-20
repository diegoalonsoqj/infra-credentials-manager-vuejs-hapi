'use strict';

const { query, withTransaction } = require('../config/database');
const { encryptQuery, decryptQuery } = require('../utils/crypto');
const { withActiveMasterKey, MasterKeyUnavailableError } = require('./credentials.repository');

// =============================================================================
// mfa.repository.js — Segundo factor (TOTP) y códigos de recuperación.
//
// El secreto TOTP se cifra con la Master Key, como una credencial: se escribe
// dentro de withActiveMasterKey (coordinado con la rotación) y la rotación lo
// re-cifra en su misma transacción (security.routes.js).
// =============================================================================

async function getState(userId) {
  const { rows } = await query(
    `SELECT mfa_enabled, mfa_secret_encrypted IS NOT NULL AS has_secret, mfa_last_step, password_hash,
            (SELECT COUNT(*)::int FROM sch_system.tbl_mfa_recovery_codes c
              WHERE c.user_id = u.id AND c.used_at IS NULL) AS recovery_left
     FROM sch_system.tbl_users u
     WHERE id = $1 AND estado_registro = 'O'`,
    [userId]
  );
  return rows[0] || null;
}

/**
 * Secreto TOTP en claro (base32), o null si no hay. Un fallo al descifrar
 * coincide con una rotación recién confirmada: se trata como clave no
 * disponible (503, reintentar), no como código incorrecto.
 */
async function getSecret(userId) {
  try {
    const { rows } = await query(
      `SELECT ${decryptQuery('mfa_secret_encrypted', 2)} AS secret
       FROM sch_system.tbl_users WHERE id = $1 AND mfa_secret_encrypted IS NOT NULL`,
      [userId, process.env.MASTER_KEY]
    );
    return rows[0] ? rows[0].secret : null;
  } catch (err) {
    if (err.code === '39000' || /Wrong key|corrupt/i.test(err.message)) throw new MasterKeyUnavailableError();
    throw err;
  }
}

/** Guarda un secreto pendiente de confirmar. No sustituye uno ya activado. */
async function savePendingSecret(userId, secret) {
  return withActiveMasterKey(async (client, masterKey) => {
    const { rowCount } = await client.query(
      `UPDATE sch_system.tbl_users
       SET mfa_secret_encrypted = ${encryptQuery(2, 3)}, mfa_last_step = 0, updated_at = NOW()
       WHERE id = $1 AND mfa_enabled = FALSE`,
      [userId, secret, masterKey]
    );
    return rowCount === 1;
  });
}

/**
 * Registra el paso TOTP aceptado, solo si es posterior al último usado. Es la
 * protección contra reutilizar un código: una sola sentencia, así que dos
 * peticiones simultáneas con el mismo código no pueden ganar las dos.
 */
async function consumeStep(userId, step, runner = { query }) {
  const { rowCount } = await runner.query(
    `UPDATE sch_system.tbl_users SET mfa_last_step = $2
     WHERE id = $1 AND mfa_last_step < $2`,
    [userId, step]
  );
  return rowCount === 1;
}

/** Marca como usado un código de recuperación (por su hash). */
async function consumeRecoveryCode(userId, codeHash) {
  const { rowCount } = await query(
    `UPDATE sch_system.tbl_mfa_recovery_codes SET used_at = NOW()
     WHERE id = (SELECT id FROM sch_system.tbl_mfa_recovery_codes
                 WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL LIMIT 1)`,
    [userId, codeHash]
  );
  return rowCount === 1;
}

async function insertCodes(client, userId, hashes) {
  await client.query('DELETE FROM sch_system.tbl_mfa_recovery_codes WHERE user_id = $1', [userId]);
  for (const h of hashes) {
    await client.query('INSERT INTO sch_system.tbl_mfa_recovery_codes (user_id, code_hash) VALUES ($1, $2)', [userId, h]);
  }
}

/** Activa el segundo factor con el primer código ya verificado y los códigos de recuperación. */
async function enable(userId, step, codeHashes) {
  return withTransaction(async (client) => {
    const { rowCount } = await client.query(
      `UPDATE sch_system.tbl_users
       SET mfa_enabled = TRUE, mfa_enabled_at = NOW(), mfa_last_step = $2, updated_at = NOW()
       WHERE id = $1 AND mfa_enabled = FALSE AND mfa_secret_encrypted IS NOT NULL AND mfa_last_step < $2`,
      [userId, step]
    );
    if (rowCount !== 1) return false;
    await insertCodes(client, userId, codeHashes);
    return true;
  });
}

async function replaceRecoveryCodes(userId, codeHashes) {
  await withTransaction((client) => insertCodes(client, userId, codeHashes));
}

/**
 * Quita el segundo factor: secreto, estado y códigos. Con `revokeSessions`
 * (restablecimiento por un ADMIN o por consola) cierra también sus sesiones.
 */
async function disable(userId, { revokeSessions = false } = {}) {
  return withTransaction(async (client) => {
    const { rowCount } = await client.query(
      `UPDATE sch_system.tbl_users
       SET mfa_enabled = FALSE, mfa_secret_encrypted = NULL, mfa_enabled_at = NULL,
           mfa_last_step = 0, updated_at = NOW()
       WHERE id = $1 AND estado_registro = 'O'`,
      [userId]
    );
    await client.query('DELETE FROM sch_system.tbl_mfa_recovery_codes WHERE user_id = $1', [userId]);
    let revoked = 0;
    if (revokeSessions) {
      const r = await client.query(
        `UPDATE sch_system.tbl_sessions SET revoked = TRUE, revoked_at = NOW()
         WHERE user_id = $1 AND revoked = FALSE`,
        [userId]
      );
      revoked = r.rowCount;
    }
    return { updated: rowCount === 1, revoked };
  });
}

module.exports = {
  getState, getSecret, savePendingSecret, consumeStep, consumeRecoveryCode,
  enable, replaceRecoveryCodes, disable,
};
