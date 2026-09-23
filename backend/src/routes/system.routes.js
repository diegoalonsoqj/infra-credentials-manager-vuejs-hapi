'use strict';

const path = require('path');
const { requireMinLevel, requirePermission } = require('../plugins/rbac');
const { ROLE_LEVELS } = require('../config/constants');
const { query } = require('../config/database');
const { clientIp } = require('../utils/clientIp');
const { updateEnvFile, isEnvSafeValue } = require('../utils/envFile');
const { PASSWORD_MIN_LENGTH_FLOOR } = require('../utils/crypto');
const settings = require('../config/settings');
const rateLimits = require('../config/rateLimits');
const logger = require('../utils/logger');
const corsConfig = require('../config/corsConfig');
const { AUDIT_ACTIONS, RESULT } = require('../config/constants');
const crypto = require('crypto');
const directory = require('../services/directory.service');
const mfaService = require('../services/mfa.service');
const { withTransaction } = require('../config/database');
const { rateLimitPre, userKey } = require('../plugins/rateLimit');
const { Joi, M, VALIDATION_OPTIONS, failAction } = require('../validation');

const ldapTestLimiter = rateLimitPre({ ...rateLimits.LDAP_TEST, keyOf: userKey });
// Guardar la conexión LDAP prueba contraseña y código del segundo factor: mismo
// límite que la gestión del segundo factor.
const ldapSaveLimiter = rateLimitPre({ ...rateLimits.MFA_MANAGE, keyOf: userKey });

// Conexión LDAP tal como la envía la tarjeta "Directorio" de Configuración.
const ldapConfigSchema = Joi.object({
  url:          Joi.string().trim().max(500).required().messages(M('La URL del servidor es requerida.')),
  bindTemplate: Joi.string().trim().max(200).required().messages(M('El formato del usuario es requerido.')),
  startTls:     Joi.boolean().required(),
  tlsVerify:    Joi.boolean().required(),
  caCert:       Joi.string().trim().max(20000).allow('').required(),
  timeoutMs:    Joi.number().integer().required().messages(M('El tiempo máximo debe ser un número entero.')),
});

const ldapTestSchema = Joi.object({
  username: Joi.string().trim().min(1).max(50).pattern(/^[a-zA-Z0-9._-]+$/).required()
    .messages(M('Usuario de dominio no válido.')),
  password: Joi.string().min(1).max(256).required().messages(M('La contraseña es requerida.')),
  // Configuración del formulario, sin guardar: se prueba antes de guardarla.
  config:   ldapConfigSchema.optional(),
});

const ldapSaveSchema = Joi.object({
  config:   ldapConfigSchema.required(),
  // Reconfirmación del ADMIN: una sesión robada no basta para desviar los logins.
  password: Joi.string().min(1).max(256).required().messages(M('Tu contraseña es requerida.')),
  code:     Joi.string().trim().min(6).max(20).required().messages(M('El código del segundo factor es requerido.')),
});

/** Configuración LDAP para el panel y la auditoría. El certificado, solo su huella. */
function describeLdap(c) {
  return {
    url: c.url, bindTemplate: c.bindTemplate, startTls: c.startTls, tlsVerify: c.tlsVerify,
    timeoutMs: c.timeoutMs, insecure: c.insecure,
    caCertSha256: c.caCert ? crypto.createHash('sha256').update(c.caCert).digest('hex').slice(0, 16) : null,
  };
}

async function auditLdap(request, action, result, { failReason = null, extra = {} } = {}) {
  const user = request.auth.credentials;
  await query(
    `INSERT INTO sch_audit.tbl_audit_log
       (user_id, username, action, resource_type, resource_name, result, fail_reason, ip_address, extra_data)
     VALUES ($1, $2, $3, 'SYS', 'ldap', $4, $5, $6, $7)`,
    [user.id, user.username, action, result, failReason, clientIp(request), JSON.stringify(extra)]
  ).catch((err) => logger.error('Error en auditoría LDAP:', { code: err.code }));
}

// =============================================================================
// system.routes.js — Configuración del sistema (tbl_system_settings).
// Prefijo /api/system.
//
// Endpoints:
//   GET  /api/system/settings/public  — Sin auth. Expone solo is_public=TRUE.
//                                        Usado por el frontend al arrancar para
//                                        cargar timezone, locale y app_name.
//   GET  /api/system/settings         — ADMIN. Todos los parámetros con metadatos.
//   PUT  /api/system/settings/:key    — ADMIN. Actualizar un parámetro.
//
// Reglas:
//   - Las claves son fijas (no se crean ni eliminan desde la API).
//   - El tipo del valor se valida en el backend antes de guardar.
//   - Cambios se reflejan en el frontend al recargar; el backend los lee de BD
//     en cada request (sin caché para no perder consistencia).
// =============================================================================

const adminSystem = [
  requirePermission('MOD_SYSTEM'),
  requireMinLevel(ROLE_LEVELS.ADMIN),
];

// ---------------------------------------------------------------------------
// Validador de valor según tipo de parámetro
// Retorna null si es válido, mensaje de error si no.
// ---------------------------------------------------------------------------
function validateValueForType(value, type) {
  switch (type) {
    case 'integer': {
      const n = parseInt(value, 10);
      if (isNaN(n) || n < 0 || n > 2147483647) return 'El valor debe ser un entero no negativo (máx. 2147483647).';
      break;
    }
    case 'boolean':
      if (value !== 'true' && value !== 'false') return 'El valor debe ser "true" o "false".';
      break;
    case 'email': {
      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRe.test(value)) return 'El valor debe ser un correo electrónico válido.';
      break;
    }
    case 'string':
      if (!value || !value.trim()) return 'El valor no puede estar vacío.';
      break;
    default:
      return 'Tipo de parámetro desconocido.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rangos de los ajustes que el backend consume (config/settings.js).
//
// El validador de tipo solo comprueba que un 'integer' sea un entero no
// negativo. Estos límites son los que hacen que el valor guardado sea además
// utilizable: fuera de rango, settings.js cae a su valor por defecto, y el
// ajuste volvería a ser un control que aparenta funcionar.
// ---------------------------------------------------------------------------
const SETTING_RANGES = {
  // De 1 minuto a 30 días.
  session_ttl_minutes:    { min: 1, max: 43200 },
  session_max_concurrent: { min: 1, max: 100 },
  // El suelo lo fija crypto.js: el ajuste solo puede endurecer la política.
  password_min_length:    { min: PASSWORD_MIN_LENGTH_FLOOR, max: 128 },
  decrypt_timeout_secs:   { min: 5, max: 300 },
  audit_retention_days:   { min: 1, max: 3650 },
  // Bloqueo de cuenta (auth.service). Con 1 o 2 intentos, un error al teclear
  // bloquea la cuenta; por encima de 20 la protección se diluye.
  account_lockout_attempts: { min: 3, max: 20 },
  account_lockout_minutes:  { min: 1, max: 1440 },
  // Inactividad (plugins/auth.js). 0 = desactivada.
  session_idle_minutes:     { min: 0, max: 1440 },
};

// Ajustes de texto con valores cerrados. Fuera de la lista, el backend caería al
// valor por defecto (settings.getString): se rechaza aquí para que el panel no
// muestre algo que no se aplica.
const SETTING_ENUMS = {
  mfa_policy: ['none', 'admins', 'all'],
};

function validateSettingEnum(key, value) {
  const allowed = SETTING_ENUMS[key];
  if (!allowed || allowed.includes(String(value))) return null;
  return `Valor no admitido. Opciones: ${allowed.join(', ')}.`;
}

/**
 * Comprueba el rango de un ajuste numérico. Devuelve null si es válido.
 */
function validateSettingRange(key, value) {
  const range = SETTING_RANGES[key];
  if (!range) return null;

  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return 'El valor debe ser un número entero.';
  if (n < range.min || n > range.max) {
    return key === 'password_min_length' && n < range.min
      ? `La longitud mínima no puede bajar de ${range.min}: es el suelo que aplican las rutas y bajarlo aquí no tendría efecto.`
      : `El valor debe estar entre ${range.min} y ${range.max}.`;
  }
  return null;
}

/**
 * Persiste CORS_ORIGIN en .env para que sobreviva a un reinicio.
 * No es crítico: el valor ya está activo en memoria.
 */
function persistCorsOrigin(value) {
  const envPath = path.resolve(__dirname, '../../.env');
  // Atomica: este .env es el mismo que guarda MASTER_KEY, JWT_SECRET y
  // DB_PASSWORD. Una escritura truncada aqui se llevaria por delante secretos
  // que no tienen nada que ver con el ajuste que se estaba guardando.
  updateEnvFile(envPath, { CORS_ORIGIN: value });
}

const settingKeyParam = Joi.object({
  key: Joi.string().min(1).required().messages(M('La clave es requerida.')),
});

const settingValueSchema = Joi.object({
  value: Joi.any().required().messages(M('El valor es requerido.')),
});

module.exports = {
  name: 'icm-routes-system',
  register(server) {
    server.route([
      // -----------------------------------------------------------------
      // GET /api/system/settings/public — Sin autenticación
      // Retorna todos los parámetros marcados como is_public=TRUE.
      // El frontend lo carga al arrancar para obtener timezone, locale y app_name.
      // -----------------------------------------------------------------
      {
        method: 'GET',
        path: '/settings/public',
        options: { auth: false },
        handler: async () => {
          const { rows } = await query(
            `SELECT key, value, type, label
             FROM sch_system.tbl_system_settings
             WHERE is_public = TRUE
             ORDER BY key`
          );

          // Retornar como objeto { key: { value, type, label } } para acceso directo
          const settings = {};
          rows.forEach((r) => {
            settings[r.key] = { value: r.value, type: r.type, label: r.label };
          });

          return { success: true, settings };
        },
      },

      // -----------------------------------------------------------------
      // GET /api/system/settings — ADMIN
      // Retorna todos los parámetros con metadatos completos.
      // -----------------------------------------------------------------
      {
        method: 'GET',
        path: '/settings',
        options: { auth: 'session', pre: adminSystem },
        handler: async () => {
          const { rows } = await query(
            `SELECT s.key, s.value, s.type, s.category, s.label, s.description,
                    s.is_public, s.updated_at, u.username AS updated_by_username
             FROM sch_system.tbl_system_settings s
             LEFT JOIN sch_system.tbl_users u ON u.id = s.updated_by
             ORDER BY s.category, s.key`
          );

          return { success: true, settings: rows };
        },
      },

      // -----------------------------------------------------------------
      // GET /api/system/rate-limits — ADMIN
      // Límites de peticiones en vigor, en solo lectura: se fijan en backend/.env
      // o en el código, no desde el panel (ver config/rateLimits.js).
      // -----------------------------------------------------------------
      {
        method: 'GET',
        path: '/rate-limits',
        options: { auth: 'session', pre: adminSystem },
        handler: () => ({
          success: true,
          windowSource: 'RATE_LIMIT_WINDOW_MS',
          limits: rateLimits.describeLimits(),
        }),
      },

      // -----------------------------------------------------------------
      // GET /api/system/ldap — ADMIN
      // Conexión LDAP guardada (categoría 'ldap' de tbl_system_settings) y si
      // está activa. El certificado de la CA se devuelve entero: es público.
      // -----------------------------------------------------------------
      {
        method: 'GET',
        path: '/ldap',
        options: { auth: 'session', pre: adminSystem },
        handler: async (request) => {
          const c = await directory.getConfig();
          return {
            success: true,
            ldap: {
              configured:   c.ok,
              error:        c.url ? c.error : null,
              enabled:      await directory.isEnabled(),
              url:          c.url,
              bindTemplate: c.bindTemplate,
              startTls:     c.startTls,
              tlsVerify:    c.tlsVerify,
              caCert:       c.caCert,
              timeoutMs:    c.timeoutMs,
              insecure:     c.insecure,
              // El panel pide el código del segundo factor para guardar.
              canSave:      request.auth.credentials.mfaEnabled === true,
            },
          };
        },
      },

      // -----------------------------------------------------------------
      // PUT /api/system/ldap — ADMIN + contraseña + segundo factor
      // Guarda la conexión LDAP. No va por PUT /settings/:key: quien controla
      // la URL recibe la contraseña de dominio de cada usuario que inicia
      // sesión, así que se exige reconfirmar la identidad (una sesión robada no
      // basta) y cada intento, correcto o no, queda en la auditoría con el valor
      // anterior y el nuevo.
      // -----------------------------------------------------------------
      {
        method: 'PUT',
        path: '/ldap',
        options: {
          auth: 'session',
          pre: [...adminSystem, ldapSaveLimiter],
          validate: { payload: ldapSaveSchema, options: VALIDATION_OPTIONS, failAction },
        },
        handler: async (request, h) => {
          const user = request.auth.credentials;
          const { config, password, code } = request.payload;

          if (!user.mfaEnabled) {
            return h.response({
              success: false,
              code: 'MFA_REQUIRED',
              message: 'Para cambiar la conexión LDAP necesitas tener activado el segundo factor (Mi Perfil).',
            }).code(403);
          }

          const next = directory.validateConfig(config);
          if (!next.ok) {
            return h.response({ success: false, code: 'INVALID_VALUE', message: next.error }).code(400);
          }

          try {
            await mfaService.reauth(user, { password, code });
          } catch (err) {
            if (err.isValidation) {
              await auditLdap(request, AUDIT_ACTIONS.LDAP_CONFIG_UPDATE, RESULT.FAIL, {
                failReason: 'Reconfirmación fallida: contraseña o código incorrectos.',
                extra: { propuesta: describeLdap(next) },
              });
              return h.response({ success: false, code: 'REAUTH_FAILED', message: err.message }).code(400);
            }
            if (err.isDirectoryUnavailable) {
              return h.response({
                success: false, code: 'DIRECTORY_UNAVAILABLE',
                message: 'No se pudo verificar tu contraseña con el directorio. Inténtalo más tarde.',
              }).code(503);
            }
            throw err;
          }

          const prev = await directory.getConfig();
          const values = {
            [directory.KEYS.url]:          next.url,
            [directory.KEYS.bindTemplate]: next.bindTemplate,
            [directory.KEYS.startTls]:     String(next.startTls),
            [directory.KEYS.tlsVerify]:    String(next.tlsVerify),
            [directory.KEYS.caCert]:       next.caCert,
            [directory.KEYS.timeoutMs]:    String(next.timeoutMs),
          };
          await withTransaction(async (client) => {
            for (const [key, value] of Object.entries(values)) {
              await client.query(
                `UPDATE sch_system.tbl_system_settings
                 SET value = $1, updated_at = NOW(), updated_by = $2
                 WHERE key = $3 AND category = 'ldap'`,
                [value, user.id, key]
              );
            }
          });
          settings.invalidate();

          await auditLdap(request, AUDIT_ACTIONS.LDAP_CONFIG_UPDATE, RESULT.SUCCESS, {
            extra: { antes: describeLdap(prev), despues: describeLdap(next) },
          });
          logger.warn('Conexión LDAP modificada.', { by: user.username, url: next.url, insecure: next.insecure });

          return { success: true, message: 'Conexión LDAP guardada.' };
        },
      },

      // -----------------------------------------------------------------
      // POST /api/system/ldap/test — ADMIN
      // Bind real con un usuario del dominio, con la configuración del
      // formulario (sin guardar) o, si no se envía, con la guardada. Funciona
      // con LDAP desactivado, para comprobarlo antes. No modifica nada y queda
      // en la auditoría.
      // -----------------------------------------------------------------
      {
        method: 'POST',
        path: '/ldap/test',
        options: {
          auth: 'session',
          pre: [...adminSystem, ldapTestLimiter],
          validate: { payload: ldapTestSchema, options: VALIDATION_OPTIONS, failAction },
        },
        handler: async (request) => {
          const { username, password, config } = request.payload;
          const cfg = config ? directory.validateConfig(config) : await directory.getConfig();
          if (!cfg.ok) return { success: false, message: cfg.error || 'La conexión LDAP no está configurada.' };

          let result;
          try {
            const r = await directory.bindAs(username, password, cfg);
            result = r.ok
              ? { success: true, message: `Conexión correcta: el directorio aceptó las credenciales de ${username}.` }
              : { success: false, message: `El directorio rechazó las credenciales. ${r.reason}` };
          } catch (err) {
            if (!err.isDirectoryUnavailable) throw err;
            result = { success: false, message: err.message };
          }

          await auditLdap(request, AUDIT_ACTIONS.LDAP_TEST, result.success ? RESULT.SUCCESS : RESULT.FAIL, {
            failReason: result.success ? null : result.message,
            extra: { usuarioPrueba: username, servidor: cfg.url, insecure: cfg.insecure },
          });

          return result;
        },
      },

      // -----------------------------------------------------------------
      // PUT /api/system/settings/:key — ADMIN
      // Actualiza el valor de un parámetro existente.
      // Valida el valor contra el tipo definido en BD para garantizar consistencia.
      // -----------------------------------------------------------------
      {
        method: 'PUT',
        path: '/settings/{key}',
        options: {
          auth: 'session',
          pre: adminSystem,
          validate: {
            params:  settingKeyParam,
            payload: settingValueSchema,
            options: VALIDATION_OPTIONS,
            failAction,
          },
        },
        handler: async (request, h) => {
          const user    = request.auth.credentials;
          const { key } = request.params;
          const { value } = request.payload;

          // Obtener el tipo actual del parámetro
          const { rows: existing } = await query(
            `SELECT key, type, category FROM sch_system.tbl_system_settings WHERE key = $1`,
            [key]
          );
          if (existing.length === 0) {
            return h.response({
              success: false,
              message: 'Parámetro de configuración no encontrado.',
            }).code(404);
          }

          // La conexión LDAP solo se cambia por PUT /api/system/ldap, que exige
          // contraseña y segundo factor. Sin esto, este PUT sería el atajo.
          if (existing[0].category === 'ldap') {
            return h.response({
              success: false,
              code: 'LDAP_REAUTH_REQUIRED',
              message: 'La conexión LDAP se cambia desde la tarjeta Directorio, reconfirmando tu identidad.',
            }).code(403);
          }

          // Validar el valor según el tipo
          const typeError = validateValueForType(String(value), existing[0].type);
          if (typeError) {
            return h.response({ success: false, code: 'INVALID_VALUE', message: typeError }).code(400);
          }

          // Rangos de los ajustes que el backend aplica de verdad. Sin esto, un
          // 0 en "duración de sesión" o un 6 en "longitud mínima" se guardaban
          // sin queja y el código los ignoraba en silencio al leerlos.
          const rangeError = validateSettingRange(key, String(value)) || validateSettingEnum(key, value);
          if (rangeError) {
            return h.response({ success: false, code: 'INVALID_VALUE', message: rangeError }).code(400);
          }

          // Activar LDAP sin el directorio bien configurado en el .env dejaría el
          // ajuste en "sí" sin que nadie pudiera entrar con él.
          if (key === 'ldap_enabled' && String(value) === 'true') {
            const ldap = await directory.getConfig();
            if (!ldap.ok) {
              return h.response({ success: false, code: 'LDAP_NOT_CONFIGURED', message: ldap.error }).code(400);
            }
          }

          // Validación adicional para cors_origin: debe ser URL http/https válida
          if (key === 'cors_origin') {
            // Este ajuste se persiste en backend/.env, el mismo archivo que
            // guarda MASTER_KEY, JWT_SECRET y DB_PASSWORD. Un salto de linea
            // dentro del valor parte la linea CORS_ORIGIN= y convierte el
            // resto en otra asignacion del .env. Y new URL() NO lo detecta: el
            // parser WHATWG descarta los saltos de linea antes de analizar la
            // cadena, de modo que la URL se da por valida mientras lo que se
            // escribe en el archivo es el texto crudo. Se comprueba antes del
            // UPDATE para no dejar la tabla y el .env diciendo cosas distintas.
            if (!isEnvSafeValue(value)) {
              return h.response({
                success: false,
                code: 'INVALID_VALUE',
                message: 'cors_origin no puede contener saltos de linea.',
              }).code(400);
            }
            try {
              const parsed = new URL(String(value));
              if (!['http:', 'https:'].includes(parsed.protocol)) {
                return h.response({
                  success: false,
                  code: 'INVALID_VALUE',
                  message: 'cors_origin debe usar protocolo http:// o https://.',
                }).code(400);
              }
            } catch {
              return h.response({
                success: false,
                code: 'INVALID_VALUE',
                message: 'cors_origin debe ser una URL válida (ej: https://icm.empresa.com).',
              }).code(400);
            }
          }

          // Actualizar
          const { rows: updated } = await query(
            `UPDATE sch_system.tbl_system_settings
             SET value = $1, updated_at = NOW(), updated_by = $2
             WHERE key = $3
             RETURNING key, value, type, category, label, description, is_public, updated_at`,
            [String(value), user.id, key]
          );

          // La caché de settings.js queda obsoleta en cuanto se guarda: sin esto
          // el nuevo valor tardaría hasta TTL_MS en aplicarse y el admin vería
          // el panel actualizado mientras el backend sigue con el anterior.
          settings.invalidate();

          // Si se actualizó cors_origin: sincronizar en memoria (efecto inmediato)
          // y persistir en .env si no es Docker (para sobrevivir reinicios).
          if (key === 'cors_origin') {
            corsConfig.origin = String(value);
            logger.info('CORS origin actualizado en memoria.', { origin: corsConfig.origin, by: user.username });

            if (process.env.DOCKER_ENV !== 'true') {
              try {
                persistCorsOrigin(String(value));
                logger.info('CORS_ORIGIN persistido en .env.', { value: String(value) });
              } catch (err) {
                // No crítico: el valor ya está activo en memoria
                logger.warn('No se pudo persistir CORS_ORIGIN en .env.', { error: err.code });
              }
            }
          }

          // Auditoría
          await query(
            `INSERT INTO sch_audit.tbl_audit_log
               (user_id, username, action, resource_type, resource_name, result, ip_address)
             VALUES ($1, $2, 'SETTING_UPDATE', 'SYS', $3, 'S', $4)`,
            [user.id, user.username, key, clientIp(request)]
          );

          logger.info('Configuración del sistema actualizada.', { key, by: user.username });

          return { success: true, setting: updated[0] };
        },
      },
    ]);
  },
};

// Se exporta para las pruebas: los rangos son parte del contrato del panel y
// merecen cobertura sin necesidad de levantar una sesion de administrador.
module.exports.validateSettingRange = validateSettingRange;
module.exports.SETTING_RANGES = SETTING_RANGES;
module.exports.validateSettingEnum = validateSettingEnum;
