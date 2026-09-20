'use strict';

const { Joi, M, normalizedEmail } = require('../validation');
const { isSetupCompleted } = require('../setup/setupState');
const { isEnvSafeValue } = require('../utils/envFile');
const {
  stepTestDatabase,
  stepValidateMasterKey,
  generateMasterKey,
  stepFinalizeSetup,
} = require('../setup/setupService');
const logger = require('../utils/logger');

// =============================================================================
// setupController.js — Handlers HTTP del wizard de instalación.
//
// Todos los endpoints (excepto getStatus) usan la estrategia de autenticación
// 'setup' (ver plugins/auth.js), que valida el header x-setup-token y bloquea
// el wizard una vez instalado el sistema con 403 SETUP_ALREADY_COMPLETED.
//
// Validaciones con Joi en options.validate de cada ruta: los errores se
// devuelven con el formato VALIDATION_ERROR descriptivo que espera el wizard.
// =============================================================================

/**
 * GET /api/setup/status
 * Retorna si el sistema está instalado.
 * SIN guard: siempre accesible para que el frontend detecte el estado.
 */
function getStatus() {
  return {
    success: true,
    installed: isSetupCompleted(),
    version: process.env.APP_VERSION || '1.0.0',
  };
}

// ---------------------------------------------------------------------------
// Esquemas de validación
// ---------------------------------------------------------------------------

// Estos valores acaban escritos como lineas de backend/.env (persistEnvConfig).
// Un salto de linea dentro de cualquiera de ellos parte la linea en dos y el
// resto pasa a ser otra asignacion del archivo, junto a JWT_SECRET y
// MASTER_KEY. utils/envFile.js lo rechaza de todos modos, pero llegar hasta
// alli significaria abortar con la base de datos ya migrada: mejor un 400 del
// wizard. No se usa .messages(M(...)) en estos campos porque el comodin '*'
// sobrescribiria el texto que devuelve este validador.
const sinSaltosDeLinea = (value, helpers) => (
  isEnvSafeValue(value) ? value : helpers.message('El valor no puede contener saltos de linea.')
);

// ssl lo envía el paso de conexión junto al resto de datos y stepTestDatabase lo
// usa. No estaba declarado y pasaba gracias a allowUnknown; con el esquema
// estricto, sin esta línea el wizard respondería 400 al probar la conexión.
const sslField = Joi.boolean().optional().messages(M('ssl debe ser verdadero o falso.'));

const testDbSchema = Joi.object({
  host: Joi.string().trim().required().messages(M('El host es requerido.')),
  port: Joi.number().integer().min(1).max(65535).required()
    .messages(M('El puerto debe ser un número entre 1 y 65535.')),
  name: Joi.string().trim().required().messages(M('El nombre de la base de datos es requerido.')),
  user: Joi.string().trim().required().messages(M('El usuario de base de datos es requerido.')),
  password: Joi.string().required().messages(M('La contraseña de base de datos es requerida.')),
  ssl: sslField,
});

const masterKeySchema = Joi.object({
  masterKey: Joi.string().min(32).required()
    .messages(M('La Master Key debe tener al menos 32 caracteres.')),
});

const finalizeSchema = Joi.object({
  dbConfig: Joi.object({
    host:     Joi.string().trim().custom(sinSaltosDeLinea).required()
      .messages({ 'string.empty': 'El host de BD es requerido.', 'any.required': 'El host de BD es requerido.', 'string.base': 'El host de BD es requerido.', 'custom': 'El host de BD no puede contener saltos de linea.' }),
    port:     Joi.number().integer().min(1).max(65535).required().messages(M('Puerto de BD inválido.')),
    name:     Joi.string().trim().custom(sinSaltosDeLinea).required()
      .messages({ 'string.empty': 'Nombre de BD requerido.', 'any.required': 'Nombre de BD requerido.', 'string.base': 'Nombre de BD requerido.', 'custom': 'El nombre de BD no puede contener saltos de linea.' }),
    user:     Joi.string().trim().custom(sinSaltosDeLinea).required()
      .messages({ 'string.empty': 'Usuario de BD requerido.', 'any.required': 'Usuario de BD requerido.', 'string.base': 'Usuario de BD requerido.', 'custom': 'El usuario de BD no puede contener saltos de linea.' }),
    password: Joi.string().custom(sinSaltosDeLinea).required()
      .messages({ 'string.empty': 'Contraseña de BD requerida.', 'any.required': 'Contraseña de BD requerida.', 'string.base': 'Contraseña de BD requerida.', 'custom': 'La contraseña de BD no puede contener saltos de linea.' }),
    ssl: sslField,
  // Sin .unknown(true): el wizard envía exactamente estos seis campos. Y sin un
  // comodín '*' en los mensajes del objeto, que habría tapado el de "campo no
  // admitido" con un "configuración requerida" que no explica nada.
  }).required().messages({
    'any.required': 'La configuración de base de datos es requerida.',
    'object.base':  'La configuración de base de datos es requerida.',
  }),

  masterKey: Joi.string().min(32).custom(sinSaltosDeLinea).required()
    .messages({
      'string.min':   'La Master Key debe tener al menos 32 caracteres.',
      'string.empty': 'La Master Key debe tener al menos 32 caracteres.',
      'any.required': 'La Master Key debe tener al menos 32 caracteres.',
      'string.base':  'La Master Key debe tener al menos 32 caracteres.',
    }),

  adminUser: Joi.object({
    username: Joi.string().trim().min(3).max(50).pattern(/^[a-zA-Z0-9_]+$/).required()
      .messages({
        'string.pattern.base': 'El username solo puede contener letras, números y guion bajo.',
        '*': 'El username debe tener entre 3 y 50 caracteres.',
      }),
    email: normalizedEmail.required().messages(M('El email no es válido.')),
    fullName: Joi.string().trim().max(200).required()
      .messages({
        'string.max': 'El nombre completo no puede superar los 200 caracteres.',
        '*': 'El nombre completo es requerido.',
      }),
    password: Joi.string().min(12).required()
      .messages(M('La contraseña debe tener al menos 12 caracteres.')),
  // Sin .unknown(true): el wizard envía solo estos cuatro campos (la
  // confirmación de contraseña se comprueba en el navegador y no viaja).
  }).required().messages({
    'any.required': 'Los datos del administrador son requeridos.',
    'object.base':  'Los datos del administrador son requeridos.',
  }),

  appPort: Joi.number().integer().min(1024).max(65535).optional()
    .messages(M('El puerto de la aplicación debe ser un número entre 1024 y 65535.')),
});

/**
 * POST /api/setup/test-db
 * Prueba la conexión a la base de datos con los datos del wizard (Paso 0).
 */
async function testDatabase(request) {
  const { host, port, name, user, password, ssl } = request.payload;
  return stepTestDatabase({ host, port, name, user, password, ssl });
}

/**
 * GET /api/setup/generate-key
 * Genera una Master Key segura aleatoria (Paso 1).
 */
function suggestMasterKey() {
  const { masterKey, entropy } = generateMasterKey();
  return {
    success: true,
    masterKey,
    entropy,
  };
}

/**
 * POST /api/setup/validate-key
 * Valida la fortaleza y entropía de una Master Key (Paso 1).
 */
function validateMasterKey(request) {
  return stepValidateMasterKey({ masterKey: request.payload.masterKey });
}

/**
 * POST /api/setup/finalize
 * Ejecuta la instalación completa en transacción atómica (Paso 3).
 * Operación larga: puede tardar varios segundos (migraciones + bcrypt f14).
 */
async function finalizeSetup(request, h) {
  logger.info('Iniciando instalación del sistema...');
  const { dbConfig, masterKey, adminUser, appPort } = request.payload;

  const result = await stepFinalizeSetup({ dbConfig, masterKey, adminUser, appPort });

  if (result.success) {
    return h.response(result).code(201);
  }
  // Error controlado del servicio (no exponer detalles técnicos)
  return h.response(result).code(500);
}

module.exports = {
  getStatus,
  testDatabase,
  suggestMasterKey,
  validateMasterKey,
  finalizeSetup,
  // Esquemas usados por las rutas
  testDbSchema,
  masterKeySchema,
  finalizeSchema,
};
