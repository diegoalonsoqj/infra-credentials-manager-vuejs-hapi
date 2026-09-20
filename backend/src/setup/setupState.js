'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../utils/logger');

// =============================================================================
// setupState.js — Gestión del estado de instalación del sistema.
//
// La detección de instalación es ENCADENADA (en orden de prioridad):
//   1. Caché en memoria (_setupCompleted) → más rápido, evita I/O repetido
//   2. Variable de entorno SETUP_COMPLETED=true → útil en Docker
//   3. Archivo .installed en el directorio del backend → bare-metal
//   4. Si ninguno: sistema NO instalado, wizard activo
//
// El setupToken es un token temporal que se muestra en logs al iniciar
// sin instalación, para que el operador pueda acceder al wizard de forma
// controlada. Se invalida al completar la instalación.
// =============================================================================

// Ruta al archivo flag de instalación (relativa al directorio del backend)
// En Docker el volumen se monta en /app/backend/data (writable por usuario icm).
// En bare-metal apunta al directorio raíz del backend (comportamiento original).
const INSTALL_FLAG_PATH = process.env.DOCKER_ENV === 'true'
  ? path.resolve(__dirname, '../../data/.installed')
  : path.resolve(__dirname, '../../.installed');

/** Caché en memoria para evitar lectura repetida del filesystem */
let _setupCompleted = null;

/** Token de acceso temporal al wizard. Generado una sola vez por proceso. */
let _setupToken = null;

/**
 * Verifica si el sistema ya fue instalado (encadenado).
 *
 * @returns {boolean} true si el sistema está instalado.
 */
function isSetupCompleted() {
  // 1. Caché en memoria (evita I/O en cada request)
  if (_setupCompleted === true) return true;

  // 2. Variable de entorno (Docker, CI, re-arranques rápidos)
  if (process.env.SETUP_COMPLETED === 'true') {
    _setupCompleted = true;
    return true;
  }

  // 3. Archivo .installed (bare-metal)
  if (fs.existsSync(INSTALL_FLAG_PATH)) {
    _setupCompleted = true;
    return true;
  }

  return false;
}

/**
 * Marca el sistema como instalado.
 * - Escribe el archivo .installed con metadata JSON.
 * - Actualiza la caché en memoria.
 * - Actualiza la variable de entorno en el proceso actual.
 *
 * @param {object} metadata - Datos adicionales a guardar en el flag.
 */
function markSetupCompleted(metadata = {}) {
  const content = JSON.stringify({
    completed_at: new Date().toISOString(),
    version: process.env.APP_VERSION || '1.0.0',
    ...metadata,
  }, null, 2);

  try {
    fs.writeFileSync(INSTALL_FLAG_PATH, content, 'utf8');
    logger.info('Flag de instalación creado.', { path: INSTALL_FLAG_PATH });
  } catch (err) {
    // La BD ya está configurada — no se puede revertir.
    // Marcamos como completado en memoria y env para que el proceso actual funcione,
    // pero advertimos que en el próximo reinicio el wizard aparecerá de nuevo
    // si no se configura SETUP_COMPLETED=true en el .env manualmente.
    logger.error(
      'CRÍTICO: No se pudo escribir el flag de instalación. ' +
      'La instalación fue exitosa pero no sobrevivirá un reinicio. ' +
      `Acción requerida: crea el archivo "${INSTALL_FLAG_PATH}" manualmente ` +
      'o añade SETUP_COMPLETED=true a tu archivo .env.',
      { errorCode: err.code, path: INSTALL_FLAG_PATH }
    );
    process.stdout.write(
      '\n⚠  ACCIÓN REQUERIDA: El archivo .installed no se pudo crear.\n' +
      '   Añade SETUP_COMPLETED=true a backend/.env para que el\n' +
      '   sistema recuerde la instalación tras reiniciar.\n\n'
    );
  }

  // Siempre actualizar en memoria y en env del proceso actual
  // (la BD ya está configurada, no hay marcha atrás)
  _setupCompleted = true;
  process.env.SETUP_COMPLETED = 'true';
}

/**
 * Obtiene o genera el token temporal de acceso al wizard.
 * Si SETUP_TOKEN está definido en .env, lo usa.
 * Si no, genera uno aleatorio y lo cachea en memoria por sesión.
 *
 * @returns {string} Token hexadecimal de 64 chars.
 */
function getSetupToken() {
  // Prioridad: variable de entorno definida explícitamente
  if (process.env.SETUP_TOKEN && process.env.SETUP_TOKEN.trim() !== '') {
    return process.env.SETUP_TOKEN.trim();
  }

  // Generar y cachear (persiste durante la vida del proceso)
  if (!_setupToken) {
    _setupToken = crypto.randomBytes(32).toString('hex');
  }

  return _setupToken;
}

/**
 * Invalida el setup token al completar la instalación.
 * Previene que el token siga siendo válido post-instalación.
 */
function invalidateSetupToken() {
  _setupToken = null;
  if (process.env.SETUP_TOKEN) {
    process.env.SETUP_TOKEN = '';
  }
}

module.exports = {
  INSTALL_FLAG_PATH,
  isSetupCompleted,
  markSetupCompleted,
  getSetupToken,
  invalidateSetupToken,
};
