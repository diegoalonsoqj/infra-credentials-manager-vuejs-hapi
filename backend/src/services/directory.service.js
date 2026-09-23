'use strict';

const { Client, InvalidCredentialsError } = require('ldapts');
const settings = require('../config/settings');
const logger = require('../utils/logger');

// =============================================================================
// directory.service.js — Autenticación contra Active Directory / LDAP.
//
// QUÉ HACE Y QUÉ NO:
//   Solo comprueba contraseñas con un bind del propio usuario. No crea usuarios
//   ni lee grupos: el alta, el rol y el equipo los decide un ADMIN en ICM. Un
//   empleado del dominio sin alta en ICM no entra aunque su contraseña sea buena.
//
// DÓNDE VIVE LA CONFIGURACIÓN:
//   En tbl_system_settings, categoría 'ldap', y se edita desde Configuración.
//   Quien controla la URL del directorio recibe la contraseña de dominio de cada
//   usuario que inicia sesión, así que guardarla NO va por el PUT genérico de
//   ajustes: PUT /api/system/ldap exige la contraseña y el código del segundo
//   factor del ADMIN y queda auditado (system.routes.js). Una sesión robada no
//   basta para redirigir los logins a otro servidor.
//
// CIFRADO:
//   ldaps:// o StartTLS si el servidor lo admite; ldap:// sin cifrar también se
//   acepta, pero entonces el bind manda la contraseña de dominio en claro por la
//   red. El panel lo avisa.
// =============================================================================

const TIMEOUT_RANGE = { min: 1000, max: 60000 };
const DEFAULT_TIMEOUT_MS = 5000;

// Claves de tbl_system_settings. ldap_enabled va aparte (categoría security):
// activar o desactivar no desvía contraseñas a ningún sitio.
const KEYS = {
  url:          'ldap_url',
  bindTemplate: 'ldap_bind_template',
  startTls:     'ldap_starttls',
  tlsVerify:    'ldap_tls_verify',
  caCert:       'ldap_tls_ca',
  timeoutMs:    'ldap_timeout_ms',
};

// Mismo patrón que el alta de usuarios (users.controller.js). Se vuelve a
// comprobar antes del bind porque el nombre acaba dentro de un DN.
const USERNAME_RE = /^[a-zA-Z0-9._-]+$/;

// Subcódigos de Active Directory en el error 49 ("data 52e", "data 775"…).
// Solo para la auditoría: al usuario siempre se le da el mensaje genérico.
const AD_DATA_CODES = {
  '525': 'Usuario no encontrado en el directorio.',
  '52e': 'Contraseña de dominio incorrecta.',
  '530': 'Inicio de sesión no permitido a esta hora (directorio).',
  '531': 'Inicio de sesión no permitido desde este equipo (directorio).',
  '532': 'Contraseña de dominio caducada.',
  '533': 'Cuenta deshabilitada en el directorio.',
  '701': 'Cuenta caducada en el directorio.',
  '773': 'El directorio exige cambiar la contraseña.',
  '775': 'Cuenta bloqueada en el directorio.',
};

class DirectoryUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DirectoryUnavailableError';
    this.isDirectoryUnavailable = true;
  }
}

/**
 * Normaliza y valida una configuración. La usan el guardado desde el panel y
 * cada login, así que nunca se aplica algo que el guardado no habría aceptado.
 *
 * @param {object} raw - { url, bindTemplate, startTls, tlsVerify, caCert, timeoutMs }
 * @returns {object} Configuración con ok, error e insecure.
 */
function validateConfig(raw) {
  const url          = String(raw.url || '').trim();
  const bindTemplate = String(raw.bindTemplate || '').trim();
  const startTls     = raw.startTls === true || raw.startTls === 'true';
  const tlsVerify    = !(raw.tlsVerify === false || raw.tlsVerify === 'false');
  const caCert       = String(raw.caCert || '').trim();
  const timeoutMs    = parseInt(raw.timeoutMs, 10);

  const isLdaps = url.toLowerCase().startsWith('ldaps://');
  const config = {
    url, bindTemplate, startTls, tlsVerify, caCert,
    timeoutMs: Number.isNaN(timeoutMs) ? DEFAULT_TIMEOUT_MS : timeoutMs,
    insecure: !isLdaps && !startTls,
    ok: false,
    error: null,
  };

  if (!url) {
    config.error = 'Falta la URL del servidor LDAP.';
  } else if (!/^ldaps?:\/\/[^\s/]+/i.test(url)) {
    config.error = 'La URL debe tener la forma ldap://servidor[:puerto] o ldaps://servidor[:puerto].';
  } else if (!bindTemplate.includes('{username}')) {
    config.error = 'El formato del usuario debe contener {username} (ej: DOMINIO\\{username}).';
  } else if (isLdaps && startTls) {
    config.error = 'StartTLS solo se usa con ldap://; con ldaps:// la conexión ya va cifrada.';
  } else if (caCert && !caCert.includes('-----BEGIN CERTIFICATE-----')) {
    config.error = 'El certificado de la CA debe estar en formato PEM (-----BEGIN CERTIFICATE-----).';
  } else if (config.timeoutMs < TIMEOUT_RANGE.min || config.timeoutMs > TIMEOUT_RANGE.max) {
    config.error = `El tiempo máximo debe estar entre ${TIMEOUT_RANGE.min} y ${TIMEOUT_RANGE.max} ms.`;
  } else {
    config.ok = true;
  }
  return config;
}

/** Configuración guardada en tbl_system_settings, ya validada. */
async function getConfig() {
  return validateConfig({
    url:          await settings.getString(KEYS.url, ''),
    bindTemplate: await settings.getString(KEYS.bindTemplate, ''),
    startTls:     await settings.getBool(KEYS.startTls, false),
    tlsVerify:    await settings.getBool(KEYS.tlsVerify, true),
    caCert:       await settings.getString(KEYS.caCert, ''),
    timeoutMs:    await settings.getInt(KEYS.timeoutMs, DEFAULT_TIMEOUT_MS, TIMEOUT_RANGE),
  });
}

/** LDAP activo: configurado y activado desde el panel. */
async function isEnabled() {
  if (!(await getConfig()).ok) return false;
  return settings.getBool('ldap_enabled', false);
}

/**
 * Bind con las credenciales del usuario.
 *
 * @param {string} username
 * @param {string} password
 * @param {object} [config] - Configuración a probar (validateConfig). Sin ella,
 *        la guardada. Permite probar desde el panel antes de guardar.
 * @returns {Promise<{ ok: boolean, reason: string|null }>} ok=false si el
 *          directorio rechaza la contraseña; reason es el motivo para auditoría.
 * @throws {DirectoryUnavailableError} si no se pudo hablar con el directorio.
 */
async function bindAs(username, password, config = null) {
  const cfg = config || await getConfig();
  if (!cfg.ok) throw new DirectoryUnavailableError(cfg.error);

  // Un bind con contraseña vacía es un bind anónimo, y AD lo da por bueno.
  if (!password) return { ok: false, reason: 'Contraseña vacía.' };
  if (!USERNAME_RE.test(String(username || ''))) {
    return { ok: false, reason: 'Nombre de usuario no válido para el directorio.' };
  }

  const tls = { rejectUnauthorized: cfg.tlsVerify, ...(cfg.caCert ? { ca: [cfg.caCert] } : {}) };
  const client = new Client({
    url:            cfg.url,
    timeout:        cfg.timeoutMs,
    connectTimeout: cfg.timeoutMs,
    tlsOptions:     cfg.url.toLowerCase().startsWith('ldaps://') ? tls : undefined,
  });

  try {
    if (cfg.startTls) await client.startTLS(tls);
    await client.bind(cfg.bindTemplate.replace('{username}', username), password);
    return { ok: true, reason: null };
  } catch (err) {
    if (err instanceof InvalidCredentialsError) {
      const sub = /data ([0-9a-f]{3})/i.exec(err.message || '');
      return { ok: false, reason: (sub && AD_DATA_CODES[sub[1].toLowerCase()]) || 'Credenciales de dominio rechazadas.' };
    }
    logger.warn('No se pudo contactar con el directorio LDAP.', { code: err.code, error: err.name });
    // Código numérico: el servidor respondió, pero con un error que no es de
    // credenciales (p. ej. InvalidDNSyntaxError si el formato del usuario no es
    // el que espera). Sin código: red, TLS o timeout.
    throw new DirectoryUnavailableError(typeof err.code === 'number'
      ? `El directorio rechazó la petición (${err.name}). Revisa el formato del usuario.`
      : `No se pudo contactar con el directorio (${err.code || err.name}).`);
  } finally {
    await client.unbind().catch(() => {});
  }
}

module.exports = { KEYS, TIMEOUT_RANGE, validateConfig, getConfig, isEnabled, bindAs, DirectoryUnavailableError };
