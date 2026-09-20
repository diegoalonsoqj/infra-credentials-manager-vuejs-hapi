'use strict';

const winston = require('winston');
require('winston-daily-rotate-file');
const path = require('path');

// =============================================================================
// logger.js — Logger seguro con redacción automática de datos sensibles.
// NUNCA loguear: passwords, tokens, master key, credentials, cookies, etc.
// El set SENSITIVE_KEYS define qué campos se redactan en cualquier log.
// =============================================================================

// Campos que NUNCA deben aparecer en logs, independientemente del contexto.
const SENSITIVE_KEYS = new Set([
  'password',
  'password_hash',
  'passwordHash',
  'master_key',
  'masterKey',
  'token',
  'token_hash',
  'tokenHash',
  'secret',
  'jwt_secret',
  'jwtSecret',
  'credential',
  'credentials',
  'encrypted_value',
  'encryptedValue',
  'password_encrypted',
  'passwordEncrypted',
  'authorization',
  'cookie',
  'key',
  'db_password',
  'dbPassword',
  'adminPassword',
  'admin_password',
  'confirmPassword',
  'confirm_password',
  'newPassword',
  'new_password',
  'currentPassword',
  'current_password',
]);

/**
 * Redacta recursivamente los campos sensibles de un objeto.
 * Reemplaza el valor por '[REDACTED]' sin modificar el objeto original.
 * Maneja arrays, objetos anidados y valores primitivos.
 *
 * @param {*} obj - El objeto, array o valor a redactar.
 * @param {number} depth - Profundidad actual (límite 10 para evitar ciclos).
 * @returns {*} Copia redactada del objeto.
 */
function redactSensitive(obj, depth = 0) {
  if (depth > 10) return '[MAX_DEPTH]';
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(item => redactSensitive(item, depth + 1));
  }

  const redacted = {};
  for (const [key, value] of Object.entries(obj)) {
    const keyLower = key.toLowerCase();
    // Verificar si alguna clave sensible es substring del key actual
    const isSensitive = [...SENSITIVE_KEYS].some(
      sensitive => keyLower === sensitive || keyLower.includes(sensitive)
    );
    redacted[key] = isSensitive ? '[REDACTED]' : redactSensitive(value, depth + 1);
  }
  return redacted;
}

// =============================================================================
// Formato compartido: timestamp ISO + nivel + mensaje + metadata redactada.
// =============================================================================
const baseFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    const safeMessage = typeof message === 'string'
      ? message
      : JSON.stringify(redactSensitive(message));

    const safeMeta = Object.keys(meta).length > 0
      ? ' ' + JSON.stringify(redactSensitive(meta))
      : '';

    const stackInfo = stack ? `\n${stack}` : '';

    return `${timestamp} [${level.toUpperCase()}] ${safeMessage}${safeMeta}${stackInfo}`;
  })
);

// =============================================================================
// Transportes según entorno.
// =============================================================================
const transports = [];

const nodeEnv = process.env.NODE_ENV || 'development';

if (nodeEnv === 'development') {
  // Consola con colores para desarrollo local
  transports.push(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize({ all: true }),
        baseFormat
      ),
    })
  );
}

if (nodeEnv === 'production') {
  const logDir = process.env.LOG_DIR || './logs';
  const maxFiles = process.env.LOG_MAX_FILES || '30d';
  const maxSize = process.env.LOG_MAX_SIZE || '20m';

  // Log general rotativo diario
  transports.push(
    new winston.transports.DailyRotateFile({
      dirname: logDir,
      filename: 'app-%DATE%.log',
      auditFile: path.join(logDir, '.app-audit.json'),
      datePattern: 'YYYY-MM-DD',
      maxFiles,
      maxSize,
      format: baseFormat,
      level: 'info',
    })
  );

  // Log de errores separado
  transports.push(
    new winston.transports.DailyRotateFile({
      dirname: logDir,
      filename: 'error-%DATE%.log',
      auditFile: path.join(logDir, '.error-audit.json'),
      datePattern: 'YYYY-MM-DD',
      maxFiles,
      maxSize,
      format: baseFormat,
      level: 'error',
    })
  );

  // Consola en producción también (para docker logs)
  transports.push(
    new winston.transports.Console({
      format: baseFormat,
    })
  );
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  transports,
  // Silencioso en tests para no contaminar la salida de Jest
  silent: nodeEnv === 'test',
});

// Exportar también la función redactSensitive para uso en otros módulos
logger.redactSensitive = redactSensitive;

module.exports = logger;
