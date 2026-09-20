'use strict';

const crypto = require('crypto');

// =============================================================================
// crypto.js — Utilidades de cifrado y seguridad.
//
// PRINCIPIOS CRÍTICOS:
// 1. El cifrado y descifrado ocurren EN POSTGRESQL con pgcrypto.
//    Este módulo solo genera los FRAGMENTOS SQL parametrizados.
// 2. La Master Key NUNCA se pasa como string interpolado en SQL.
//    Siempre va como parámetro ($N) en queries parametrizadas.
// 3. Solo se almacena el hash SHA-256 de la Master Key en BD.
//    La clave real vive exclusivamente en la variable de entorno MASTER_KEY.
// =============================================================================

// Opciones de pgp_sym_encrypt. NO son entrada de usuario: es una constante del
// modulo que se interpola en el SQL, nunca un valor que venga del request.
//
// POR QUE SE FIJAN:
//   Sin el tercer argumento, pgp_sym_encrypt usa los valores por defecto de la
//   compilacion de pgcrypto. Comprobado sobre PostgreSQL 16.8 inspeccionando el
//   paquete OpenPGP resultante, esos defaults son cipher-algo AES-128 (id 7) y
//   s2k-digest-algo SHA-1 (id 2). Ninguno esta roto para este uso, pero quedaban
//   IMPLICITOS: otra version o compilacion de pgcrypto podia cambiarlos sin que
//   nada en el sistema lo notara, y un almacen de credenciales no deberia dejar
//   su algoritmo de cifrado a merced del valor por defecto de una extension.
//
// COMPATIBILIDAD:
//   pgp_sym_decrypt lee el algoritmo de cada paquete, asi que las credenciales
//   cifradas antes de este cambio se siguen descifrando sin tocar nada. Los dos
//   formatos conviven. Para migrar las antiguas basta con una rotacion de Master
//   Key (POST /api/security/rotate-key), que re-cifra todas las filas.
const PGP_SYM_OPTIONS = 'cipher-algo=aes256, s2k-digest-algo=sha256';

/**
 * Genera el fragmento SQL para cifrar un valor con pgp_sym_encrypt.
 * Uso en INSERT:
 *   const params = [username, plainPassword, masterKey];
 *   const sql = `INSERT INTO tbl_credentials (username, password_encrypted)
 *                VALUES ($1, ${encryptQuery(2, 3)})`;
 *
 * @param {number} valueParamIndex - Índice ($N) del parámetro con el valor a cifrar.
 * @param {number} keyParamIndex   - Índice ($N) del parámetro con la master key.
 * @returns {string} Fragmento SQL listo para usar en query parametrizada.
 */
function encryptQuery(valueParamIndex, keyParamIndex) {
  return `pgp_sym_encrypt($${valueParamIndex}::text, $${keyParamIndex}::text, '${PGP_SYM_OPTIONS}')`;
}

/**
 * Genera el fragmento SQL para descifrar una columna con pgp_sym_decrypt.
 * Uso en SELECT:
 *   const params = [credentialId, masterKey];
 *   const sql = `SELECT ${decryptQuery('password_encrypted', 2)} AS password
 *                FROM sch_secret.tbl_credentials WHERE id = $1`;
 *
 * IMPORTANTE: el descifrado ocurre ÚNICAMENTE en backend.
 * El resultado NUNCA se envía al frontend en texto plano.
 *
 * @param {string} columnName     - Nombre de la columna cifrada.
 * @param {number} keyParamIndex  - Índice ($N) del parámetro con la master key.
 * @returns {string} Fragmento SQL listo para usar en query parametrizada.
 */
function decryptQuery(columnName, keyParamIndex) {
  return `pgp_sym_decrypt(${columnName}::bytea, $${keyParamIndex}::text)`;
}

/**
 * Calcula el hash SHA-256 de la Master Key.
 * Este hash es el ÚNICO dato de la key que se almacena en BD.
 *
 * @param {string} masterKey - La Master Key en texto plano.
 * @returns {string} SHA-256 hex (64 caracteres).
 */
function hashMasterKey(masterKey) {
  return crypto.createHash('sha256').update(masterKey).digest('hex');
}

/**
 * Verifica que una Master Key corresponda al hash almacenado en BD.
 * Usa comparación en tiempo constante para prevenir timing attacks.
 *
 * @param {string} masterKey   - La Master Key a verificar.
 * @param {string} storedHash  - El hash SHA-256 almacenado en tbl_master_config.
 * @returns {boolean} true si la key es válida.
 */
function verifyMasterKey(masterKey, storedHash) {
  if (!masterKey || !storedHash) return false;
  const computedHash = hashMasterKey(masterKey);
  // Buffer comparison en tiempo constante para prevenir timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(computedHash, 'hex'),
      Buffer.from(storedHash, 'hex')
    );
  } catch {
    return false;
  }
}

/**
 * Genera una Master Key segura aleatoria.
 * 48 bytes → 64 chars en base64url (URL-safe, sin padding =).
 * Cumple holgadamente el requisito mínimo de 32 caracteres con alta entropía.
 *
 * @returns {string} Master Key segura lista para usar.
 */
function generateMasterKey() {
  return crypto.randomBytes(48).toString('base64url');
}

// Suelo absoluto de longitud. El ajuste password_min_length del panel puede
// SUBIRLO, nunca bajarlo: es el mismo 12 que exigen los esquemas Joi de las
// rutas, y dejar que la configuración lo relajase abriría un camino para
// debilitar la política desde la interfaz sin que se note.
const PASSWORD_MIN_LENGTH_FLOOR = 12;

/**
 * Valida la fortaleza de una contraseña de usuario.
 * Requisitos: longitud mínima, mayúscula, minúscula, número, especial.
 *
 * @param {string} password - La contraseña a validar.
 * @param {number} [minLength] - Longitud mínima exigida. Se acota por abajo a
 *        PASSWORD_MIN_LENGTH_FLOOR; por defecto es ese mismo valor.
 * @returns {{ valid: boolean, message: string, checks: object }}
 */
function validatePasswordStrength(password, minLength = PASSWORD_MIN_LENGTH_FLOOR) {
  if (!password || typeof password !== 'string') {
    return { valid: false, message: 'La contraseña es requerida.', checks: {} };
  }

  const required = Math.max(PASSWORD_MIN_LENGTH_FLOOR, Number(minLength) || 0);

  const checks = {
    minLength:    password.length >= required,
    hasUppercase: /[A-Z]/.test(password),
    hasLowercase: /[a-z]/.test(password),
    hasNumber:    /[0-9]/.test(password),
    hasSpecial:   /[^A-Za-z0-9]/.test(password),
  };

  const valid = Object.values(checks).every(Boolean);

  if (!valid) {
    const missing = [];
    if (!checks.minLength)    missing.push(`mínimo ${required} caracteres`);
    if (!checks.hasUppercase) missing.push('al menos una mayúscula');
    if (!checks.hasLowercase) missing.push('al menos una minúscula');
    if (!checks.hasNumber)    missing.push('al menos un número');
    if (!checks.hasSpecial)   missing.push('al menos un carácter especial');
    return { valid, message: `La contraseña requiere: ${missing.join(', ')}.`, checks };
  }

  return { valid, message: 'Contraseña válida.', checks };
}

/**
 * Estima el nivel de entropía de un string (útil para evaluar la Master Key).
 * Calcula el espacio de caracteres usado y estima bits de entropía.
 *
 * @param {string} str - El string a evaluar.
 * @returns {'alta'|'media'|'baja'} Nivel de entropía estimado.
 */
function estimateEntropy(str) {
  if (!str || str.length < 32) return 'baja';

  let charsetSize = 0;
  if (/[a-z]/.test(str))      charsetSize += 26;
  if (/[A-Z]/.test(str))      charsetSize += 26;
  if (/[0-9]/.test(str))      charsetSize += 10;
  if (/[^a-zA-Z0-9]/.test(str)) charsetSize += 32; // símbolos comunes

  if (charsetSize === 0) return 'baja';

  const entropyBits = str.length * Math.log2(charsetSize);

  if (entropyBits >= 160) return 'alta';
  if (entropyBits >= 100) return 'media';
  return 'baja';
}

module.exports = {
  encryptQuery,
  decryptQuery,
  hashMasterKey,
  verifyMasterKey,
  generateMasterKey,
  validatePasswordStrength,
  estimateEntropy,
  PASSWORD_MIN_LENGTH_FLOOR,
  PGP_SYM_OPTIONS,
};
