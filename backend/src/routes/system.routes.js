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
const { Joi, M, VALIDATION_OPTIONS, failAction } = require('../validation');

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
            `SELECT key, type FROM sch_system.tbl_system_settings WHERE key = $1`,
            [key]
          );
          if (existing.length === 0) {
            return h.response({
              success: false,
              message: 'Parámetro de configuración no encontrado.',
            }).code(404);
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
