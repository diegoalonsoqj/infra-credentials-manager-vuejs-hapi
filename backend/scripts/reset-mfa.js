'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { query, closePool } = require('../src/config/database');
const { AUDIT_ACTIONS, RESULT } = require('../src/config/constants');

// =============================================================================
// reset-mfa.js — Quita el segundo factor de un usuario desde el servidor.
//
//   npm run reset-mfa -- <username>
//
// Para cuando quien lo perdió es el único ADMIN y no hay nadie que pueda
// restablecérselo desde el panel. Exige acceso al servidor y al .env, así que
// no es un atajo para nadie más: el mismo nivel de acceso que ya permitiría
// leer la Master Key.
//
// Borra el secreto y los códigos de recuperación y revoca sus sesiones. Si la
// política (mfa_policy) le obliga, en su siguiente acceso solo podrá volver a
// activarlo.
// =============================================================================

async function main() {
  const username = process.argv[2];
  if (!username) {
    console.error('Uso: npm run reset-mfa -- <username>');
    process.exitCode = 1;
    return;
  }

  const { rows } = await query(
    `SELECT id, username, mfa_enabled FROM sch_system.tbl_users
     WHERE username = $1 AND estado_registro = 'O'`,
    [username]
  );
  const user = rows[0];
  if (!user) {
    console.error(`No existe el usuario '${username}'.`);
    process.exitCode = 1;
    return;
  }

  await query(
    `UPDATE sch_system.tbl_users
     SET mfa_enabled = FALSE, mfa_secret_encrypted = NULL, mfa_enabled_at = NULL,
         mfa_last_step = 0, updated_at = NOW()
     WHERE id = $1`,
    [user.id]
  );
  await query('DELETE FROM sch_system.tbl_mfa_recovery_codes WHERE user_id = $1', [user.id]);
  const { rowCount: revocadas } = await query(
    `UPDATE sch_system.tbl_sessions SET revoked = TRUE, revoked_at = NOW()
     WHERE user_id = $1 AND revoked = FALSE`,
    [user.id]
  );

  await query(
    `INSERT INTO sch_audit.tbl_audit_log
       (user_id, username, action, resource_type, resource_id, resource_name, result, fail_reason, extra_data)
     VALUES ($1, $2, $3, 'SYS', $4, $5, $6, $7, $8)`,
    [user.id, user.username, AUDIT_ACTIONS.MFA_RESET, String(user.id), user.username, RESULT.SUCCESS,
     'Restablecido desde la consola del servidor.', JSON.stringify({ revokedSessions: revocadas, via: 'cli' })]
  );

  console.log(`Segundo factor restablecido para '${user.username}'.`);
  console.log(`Sesiones cerradas: ${revocadas}. Deberá volver a activarlo si la política lo exige.`);
}

main()
  .catch((err) => { console.error('Error:', err.message); process.exitCode = 1; })
  .finally(() => closePool());
