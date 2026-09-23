'use strict';

// =============================================================================
// reset-admin-password.js — Resetea la contraseña de un usuario administrador.
//
// Uso (desde la carpeta backend/):
//   node scripts/reset-admin-password.js <username>
//     -> pide la contraseña por consola, sin mostrarla.
//   echo "MiClave" | node scripts/reset-admin-password.js <username>
//     -> para automatizaciones.
//
// Sin argumentos lista los usuarios ADMIN disponibles.
//
// NO se recomienda pasar la contraseña como argumento: en Windows queda en la
// lista de procesos y, sobre todo, en el historial de PowerShell, que PSReadLine
// guarda en texto plano en ConsoleHost_history.txt. Se admite por compatibilidad
// y el script avisa cuando se usa.
//
// - Usa las credenciales de BD definidas en backend/.env
// - Exige la misma fortaleza de contraseña que la API (validatePasswordStrength)
// - Genera el hash con bcrypt factor 14 (igual que el wizard de instalación)
// - Limpia failed_attempts y locked_until (desbloquea la cuenta)
// - Marca force_pwd_change para que el usuario deba cambiarla al entrar,
//   igual que hace el reseteo desde el panel de administración
// - Si el usuario era LDAP, lo pasa a LOCAL: es la salida de emergencia cuando
//   el directorio no responde y no queda ningún administrador que pueda entrar
// =============================================================================

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const bcrypt   = require('bcryptjs');
const readline = require('readline');
const { Pool } = require('pg');
const { validatePasswordStrength } = require('../src/utils/crypto');

const BCRYPT_FACTOR = 14;

/**
 * Lee la contraseña por stdin. Con terminal interactiva no la muestra;
 * con una tubería la toma tal cual, para poder automatizar.
 */
function readPasswordFromStdin() {
  return new Promise((resolve) => {
    const isTty = Boolean(process.stdin.isTTY);
    const rl = readline.createInterface({
      input:    process.stdin,
      output:   process.stdout,
      terminal: isTty,
    });

    if (isTty) {
      // readline reproduce cada pulsación: se silencia su salida mientras se
      // teclea para que la contraseña no quede escrita en pantalla.
      rl._writeToOutput = () => {};
      process.stdout.write('Nueva contraseña (no se muestra): ');
    }

    rl.question('', (answer) => {
      rl.close();
      if (isTty) process.stdout.write('\n');
      resolve((answer || '').trim());
    });
  });
}

async function main() {
  const [, , username, passwordArg] = process.argv;

  const pool = new Pool({
    host:     process.env.DB_HOST || 'localhost',
    port:     parseInt(process.env.DB_PORT, 10) || 5432,
    database: process.env.DB_NAME,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    // Validación de cert segura por defecto (igual que database.js):
    // rejectUnauthorized: true salvo que se opte explícitamente por desactivarla.
    ssl:      process.env.DB_SSL === 'true'
      ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' }
      : false,
    max: 1,
  });

  try {
    // Sin username: listar administradores y salir.
    if (!username) {
      const { rows } = await pool.query(
        `SELECT u.username, u.email, r.code AS role, u.estado, u.auth_source
           FROM sch_system.tbl_users u
           JOIN sch_system.tbl_roles r ON r.id = u.role_id
          WHERE r.code = 'ADMIN' AND u.estado_registro = 'O'
          ORDER BY u.username`
      );
      console.log('\nUsuarios ADMIN encontrados:');
      if (rows.length === 0) {
        console.log('  (ninguno)');
      } else {
        rows.forEach((r) =>
          console.log(`  - ${r.username}  <${r.email}>  estado=${r.estado}  origen=${r.auth_source}`)
        );
      }
      console.log('\nUso: node scripts/reset-admin-password.js <username>');
      console.log('     (la contraseña se pide por consola y no se muestra)\n');
      return;
    }

    if (passwordArg) {
      console.warn(
        '\n⚠  Has pasado la contraseña como argumento: queda en el historial del shell\n' +
        '   y en la lista de procesos. Ejecuta el script sin ella para que te la pida.\n'
      );
    }

    const newPassword = passwordArg || await readPasswordFromStdin();

    if (!newPassword) {
      console.error('\n✗ No se recibió ninguna contraseña.\n');
      process.exitCode = 1;
      return;
    }

    // Misma exigencia que la API: sin esto el script era una puerta trasera para
    // dejar una contraseña débil en una cuenta de administrador.
    const strength = validatePasswordStrength(newPassword);
    if (!strength.valid) {
      console.error(`\n✗ ${strength.message}\n`);
      process.exitCode = 1;
      return;
    }

    const hash = await bcrypt.hash(newPassword, BCRYPT_FACTOR);

    const { rows: updated } = await pool.query(
      `UPDATE sch_system.tbl_users u
          SET password_hash    = $1,
              auth_source      = 'LOCAL',
              failed_attempts  = 0,
              locked_until     = NULL,
              force_pwd_change = TRUE,
              updated_at       = NOW()
         FROM (SELECT id, auth_source FROM sch_system.tbl_users
                WHERE username = $2 AND estado_registro = 'O') prev
        WHERE u.id = prev.id
        RETURNING prev.auth_source AS previous_source`,
      [hash, username]
    );

    if (updated.length === 0) {
      console.error(`\n✗ No se encontró un usuario activo con username "${username}".\n`);
      process.exitCode = 1;
      return;
    }

    console.log(
      `\n✓ Contraseña actualizada para "${username}". Cuenta desbloqueada.\n` +
      '  Deberá cambiarla en el primer inicio de sesión.\n' +
      (updated[0].previous_source === 'LDAP'
        ? '  Era un usuario LDAP: ahora usa contraseña local de ICM.\n'
        : '')
    );
  } catch (err) {
    console.error('\n✗ Error:', err.message, '\n');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
