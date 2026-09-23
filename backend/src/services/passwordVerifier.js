'use strict';

const bcrypt    = require('bcryptjs');
const directory = require('./directory.service');

// =============================================================================
// passwordVerifier.js — Comprueba la contraseña de un usuario según su origen.
//
//   LOCAL → bcrypt contra tbl_users.password_hash.
//   LDAP  → bind contra el directorio (directory.service.js). No hay hash en BD.
//
// Lo usan los tres sitios que piden la contraseña: el login, el cambio de
// contraseña del perfil y la confirmación para tocar el segundo factor. Antes
// cada uno llamaba a bcrypt por su cuenta, y un usuario LDAP (password_hash
// NULL) habría hecho fallar a los tres.
// =============================================================================

// Hash bcrypt "señuelo" de factor 14, generado una sola vez al cargar el módulo.
// Se compara contra él cuando el usuario NO existe o está inactivo, para que la
// respuesta tarde lo mismo que un login con usuario válido. Sin esto, el login
// de un usuario inexistente respondería más rápido (no ejecuta bcrypt) y permitiría
// enumerar usuarios válidos por diferencia de tiempo.
const DUMMY_BCRYPT_HASH = bcrypt.hashSync('icm_timing_safe_dummy_password', 14);

/**
 * @param {{ username: string, auth_source?: string, password_hash?: string|null }} user
 * @param {string} password
 * @param {{ skipDirectory?: boolean }} [options] - skipDirectory: no contactar
 *        con el directorio (cuenta bloqueada en ICM; ver auth.service).
 * @returns {Promise<{ ok: boolean, reason: string|null, countable: boolean }>}
 *          countable=false: el fallo no es culpa de quien teclea (LDAP
 *          desactivado) y no debe sumar al bloqueo de cuenta.
 * @throws {directory.DirectoryUnavailableError} si el directorio no responde.
 */
async function verifyPassword(user, password, options = {}) {
  const plain = String(password || '');

  if (user.auth_source !== 'LDAP') {
    const ok = await bcrypt.compare(plain, user.password_hash || DUMMY_BCRYPT_HASH) && Boolean(user.password_hash);
    return { ok, reason: ok ? null : 'Contraseña incorrecta.', countable: true };
  }

  // Usuario LDAP. bcrypt se ejecuta igualmente, en paralelo con el bind: un
  // bind tarda milisegundos y bcrypt f14 casi un segundo, así que sin él la
  // respuesta delataría qué usuarios existen y son de dominio.
  const timing = bcrypt.compare(plain, DUMMY_BCRYPT_HASH);

  let result;
  try {
    if (options.skipDirectory) {
      result = { ok: false, reason: 'Cuenta bloqueada en ICM: no se consulta el directorio.', countable: true };
    } else if (!(await directory.isEnabled())) {
      result = { ok: false, reason: 'La autenticación LDAP está desactivada.', countable: false };
    } else {
      result = { ...(await directory.bindAs(user.username, plain)), countable: true };
    }
  } finally {
    await timing;
  }
  return result;
}

module.exports = { verifyPassword, DUMMY_BCRYPT_HASH };
