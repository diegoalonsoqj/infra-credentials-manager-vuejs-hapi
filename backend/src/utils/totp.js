'use strict';

const crypto = require('crypto');

// =============================================================================
// utils/totp.js — Códigos TOTP (RFC 6238) para el segundo factor.
//
// Los parámetros son los que usan por defecto Aegis, Google Authenticator,
// Microsoft Authenticator y el resto de aplicaciones: HMAC-SHA1, 6 dígitos y
// pasos de 30 segundos. Sin dependencias: HOTP (RFC 4226) son quince líneas
// sobre crypto, y la base32 del secreto otras tantas. Los vectores de prueba
// de la RFC están en tests/totp.test.js.
// =============================================================================

const STEP_SECONDS = 30;
const DIGITS       = 6;
// Pasos de tolerancia a cada lado: ±30 s de desfase de reloj entre el móvil y
// el servidor, como hacen las implementaciones habituales.
const WINDOW       = 1;
const BASE32       = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx === -1) throw new Error('Secreto base32 no válido.');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Secreto nuevo: 20 bytes aleatorios (160 bits, lo que recomienda la RFC 4226). */
function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

/** Código HOTP de un contador. `key` es el secreto ya decodificado. */
function hotp(key, counter, digits = DIGITS) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

function currentStep(nowMs = Date.now()) {
  return Math.floor(nowMs / 1000 / STEP_SECONDS);
}

/** Código TOTP de un paso concreto (para pruebas y para el propio verificador). */
function codeAt(secretBase32, step, digits = DIGITS) {
  return hotp(base32Decode(secretBase32), step, digits);
}

/**
 * Comprueba un código contra el paso actual ±WINDOW.
 *
 * @returns {number|null} el paso con el que coincide, o null. Quien llama debe
 *   registrarlo (mfa_last_step) y rechazar pasos ya usados: así un código no
 *   vale dos veces.
 */
function verify(secretBase32, code, nowMs = Date.now()) {
  if (!/^\d{6}$/.test(String(code || ''))) return null;
  const key = base32Decode(secretBase32);
  const now = currentStep(nowMs);
  const given = Buffer.from(String(code));
  let matched = null;
  // Se recorren siempre todos los pasos de la ventana y se compara en tiempo
  // constante: el tiempo de respuesta no dice cuánto se acercó el código.
  for (let s = now - WINDOW; s <= now + WINDOW; s++) {
    if (crypto.timingSafeEqual(Buffer.from(hotp(key, s)), given) && matched === null) matched = s;
  }
  return matched;
}

/** URI otpauth:// que codifica el QR que se escanea con Aegis. */
function otpauthUri({ issuer, account, secret }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

module.exports = {
  generateSecret, verify, codeAt, currentStep, otpauthUri,
  base32Encode, base32Decode, hotp,
  STEP_SECONDS, DIGITS, WINDOW,
};
