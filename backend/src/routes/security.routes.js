'use strict';

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const { requireMinLevel, requirePermission } = require('../plugins/rbac');
const { ROLE_LEVELS, AUDIT_ACTIONS, RESULT } = require('../config/constants');
const { withTransaction, query } = require('../config/database');
const {
  hashMasterKey, verifyMasterKey, generateMasterKey, estimateEntropy, PGP_SYM_OPTIONS,
} = require('../utils/crypto');
const { clientIp } = require('../utils/clientIp');
const { updateEnvFile, isEnvSafeValue } = require('../utils/envFile');
const logger = require('../utils/logger');
const { Joi, M, VALIDATION_OPTIONS, failAction } = require('../validation');

// =============================================================================
// security.routes.js — Rotación de Master Key. Prefijo /api/security.
//
// REGLAS CRÍTICAS:
//   1. La Master Key NUNCA aparece en logs, responses ni variables de entorno
//      expuestas. Solo como parámetro SQL ($N) o en process.env.MASTER_KEY.
//   2. El re-cifrado ocurre ÍNTEGRAMENTE en PostgreSQL (pgp_sym_decrypt +
//      pgp_sym_encrypt en un solo UPDATE). El plaintext nunca toca Node.js.
//   3. La operación es atómica: withTransaction() hace ROLLBACK completo si
//      cualquier paso falla. Nunca queda estado parcial en BD.
//   4. El .env se actualiza DESPUÉS del COMMIT. Si falla el .env, process.env
//      ya tiene la nueva clave (el proceso sigue funcionando), pero se loguea
//      un error crítico para que el operador actualice el archivo manualmente.
//   5. Solo ADMIN puede ejecutar esta operación.
// =============================================================================

const ENV_PATH = path.resolve(__dirname, '../../.env');

const adminSecurity = [
  requirePermission('MOD_SECURITY'),
  requireMinLevel(ROLE_LEVELS.ADMIN),
];

// ---------------------------------------------------------------------------
// Helper: actualizar MASTER_KEY en .env (mismo patrón que el wizard)
// ---------------------------------------------------------------------------
/**
 * Comprueba que el .env se podra escribir DESPUES del commit.
 *
 * El re-cifrado se confirma en base de datos antes de tocar el archivo. Si la
 * escritura fallara entonces, la nueva clave viviria solo en process.env y se
 * perderia con el proceso, dejando las credenciales ilegibles. Comprobarlo
 * antes convierte ese escenario en un error limpio que no toca nada.
 *
 * @returns {string|null} Codigo de error si no se puede escribir; null si todo bien.
 */
function envWriteBlocker() {
  try {
    if (fs.existsSync(ENV_PATH)) fs.accessSync(ENV_PATH, fs.constants.W_OK);
    else fs.accessSync(path.dirname(ENV_PATH), fs.constants.W_OK);
    return null;
  } catch (err) {
    return err.code || 'EACCES';
  }
}

function updateEnvMasterKey(newKey) {
  // Escritura atomica (temporal + fsync + rename): si esta escritura se
  // truncara a la mitad, la MASTER_KEY se perderia y las credenciales que
  // acaban de re-cifrarse en el COMMIT anterior serian irrecuperables.
  updateEnvFile(ENV_PATH, { MASTER_KEY: newKey });
}

// ---------------------------------------------------------------------------
// Helper: bloqueo de la clave activa durante la rotación
// ---------------------------------------------------------------------------

/** Otra rotación se confirmó mientras esta esperaba el bloqueo. */
class RotationConflictError extends Error {
  constructor() {
    super('Otra rotación de la Master Key terminó mientras esta esperaba. Revisa el estado de la clave antes de reintentar.');
    this.name = 'RotationConflictError';
    this.isRotationConflict = true;
  }
}

/**
 * Bloquea con FOR UPDATE la fila de la Master Key activa. Es la primera
 * sentencia de la transacción de rotación.
 *
 * 1. Frena las escrituras de credenciales hasta el COMMIT. Cada escritura toma
 *    esta fila con FOR SHARE y verifica contra ella la clave con la que cifra
 *    (withActiveMasterKey en credentials.repository.js). Sin este bloqueo, una
 *    credencial creada o cambiada durante el re-cifrado quedaba cifrada con la
 *    clave vieja, y la clave vieja se descarta al terminar.
 * 2. Descarta una rotación concurrente. La segunda espera aquí; cuando la
 *    primera confirma, la fila ya no está activa y no se devuelve. Antes la
 *    segunda seguía adelante y fallaba a mitad del UPDATE al descifrar con una
 *    clave que ya no era la de las filas.
 *
 * @param {object} client - Cliente dentro de la transacción.
 * @param {string|number} expectedId - Id de la clave activa leída antes de la transacción.
 * @throws {RotationConflictError}
 */
async function lockActiveKeyRow(client, expectedId) {
  const { rows } = await client.query(
    `SELECT id FROM sch_secret.tbl_master_config
     WHERE is_active = TRUE
     FOR UPDATE`
  );
  if (!rows.some((r) => String(r.id) === String(expectedId))) {
    throw new RotationConflictError();
  }
}

// ---------------------------------------------------------------------------
// Helper: auditoría
// ---------------------------------------------------------------------------
async function auditRotation({ actorId, actorUsername, action, result, failReason, ipAddress, credentialsRecrypted }) {
  try {
    await query(
      `INSERT INTO sch_audit.tbl_audit_log
         (user_id, username, action, resource_type, result, fail_reason, ip_address, extra_data)
       VALUES ($1,$2,$3,'SYS',$4,$5,$6,$7)`,
      [
        actorId, actorUsername, action, result,
        failReason || null, ipAddress || null,
        JSON.stringify(credentialsRecrypted != null ? { credentials_recrypted: credentialsRecrypted } : {}),
      ]
    );
  } catch (err) {
    logger.error('Error en auditoría de rotación:', { code: err.code });
  }
}

const rotationSchema = Joi.object({
  newKey: Joi.string().min(1).required()
    .messages(M('La nueva Master Key es requerida.')),
  currentKeyConfirm: Joi.string().min(1).required()
    .messages(M('Debes confirmar la clave actual.')),
});

module.exports = {
  name: 'icm-routes-security',
  register(server) {
    server.route([
      // -----------------------------------------------------------------
      // GET /api/security/key-status — Estado actual de la Master Key (ADMIN)
      // -----------------------------------------------------------------
      {
        method: 'GET',
        path: '/key-status',
        options: { auth: 'session', pre: adminSecurity },
        handler: async () => {
          const { rows } = await query(
            `SELECT id, key_alias, key_hash, kms_provider, is_active,
                    credentials_recrypted, created_at, rotated_at
             FROM sch_secret.tbl_master_config
             ORDER BY created_at DESC`
          );

          const active  = rows.find((r) => r.is_active) || null;
          const history = rows.filter((r) => !r.is_active);

          // Contar credenciales activas que serían afectadas por una rotación
          const { rows: countRows } = await query(
            `SELECT COUNT(*) AS total FROM sch_secret.tbl_credentials WHERE estado_registro = 'O'`
          );

          // Verificar que la key en process.env coincide con el hash en BD
          const envKeyMatchesDb = active
            ? verifyMasterKey(process.env.MASTER_KEY || '', active.key_hash)
            : false;

          return {
            success: true,
            active: active ? {
              id:                    active.id,
              key_alias:             active.key_alias,
              key_hash_preview:      active.key_hash.slice(0, 12) + '…',  // solo primeros 12 chars
              kms_provider:          active.kms_provider,
              credentials_recrypted: active.credentials_recrypted,
              created_at:            active.created_at,
              env_key_matches_db:    envKeyMatchesDb,
            } : null,
            history: history.map((r) => ({
              id:         r.id,
              key_alias:  r.key_alias,
              created_at: r.created_at,
              rotated_at: r.rotated_at,
              credentials_recrypted: r.credentials_recrypted,
            })),
            credentials_to_reencrypt: parseInt(countRows[0].total, 10),
          };
        },
      },

      // -----------------------------------------------------------------
      // POST /api/security/generate-key — Genera una nueva Master Key segura
      // -----------------------------------------------------------------
      {
        method: 'POST',
        path: '/generate-key',
        options: { auth: 'session', pre: adminSecurity },
        handler: () => ({ success: true, key: generateMasterKey() }),
      },

      // -----------------------------------------------------------------
      // POST /api/security/rotate-key — Ejecutar rotación (ADMIN, crítico)
      // -----------------------------------------------------------------
      {
        method: 'POST',
        path: '/rotate-key',
        options: {
          auth: 'session',
          pre: adminSecurity,
          validate: { payload: rotationSchema, options: VALIDATION_OPTIONS, failAction },
        },
        handler: async (request, h) => {
          const user = request.auth.credentials;
          const { newKey, currentKeyConfirm } = request.payload;
          const actor = { id: user.id, username: user.username, ip: clientIp(request) };
          const currentSessionId = user.sessionId;

          // Guard: si por alguna razón no tenemos el sessionId, abortamos antes de
          // ejecutar la rotación para no revocar accidentalmente TODAS las sesiones.
          if (!currentSessionId) {
            logger.error('rotate-key: sessionId no disponible en las credenciales. Operación abortada.', { username: actor.username });
            return h.response({
              success: false,
              message: 'Error interno de sesión. Vuelve a iniciar sesión e intenta nuevamente.',
            }).code(500);
          }

          // --- Validaciones previas a la transacción ---

          // 1. Verificar que la clave actual confirmada coincide con process.env
          const currentKey = process.env.MASTER_KEY;
          if (!currentKey) {
            return h.response({ success: false, message: 'MASTER_KEY no configurada en el servidor.' }).code(500);
          }

          // Comparación en tiempo constante para prevenir timing attacks.
          // Se usa padding al tamaño mayor para que timingSafeEqual siempre ejecute
          // (evita cortocircuito en la comparación de longitud que filtraría la longitud real).
          const bufConfirm = Buffer.from(currentKeyConfirm);
          const bufCurrent = Buffer.from(currentKey);
          const maxLen     = Math.max(bufConfirm.length, bufCurrent.length);
          const padA       = Buffer.alloc(maxLen);
          const padB       = Buffer.alloc(maxLen);
          bufConfirm.copy(padA);
          bufCurrent.copy(padB);
          const keyMatch   = crypto.timingSafeEqual(padA, padB) &&
                             bufConfirm.length === bufCurrent.length;

          if (!keyMatch) {
            await auditRotation({
              actorId: actor.id, actorUsername: actor.username,
              action: AUDIT_ACTIONS.MASTER_KEY_ROTATION_FAIL,
              result: RESULT.FAIL,
              failReason: 'Clave actual incorrecta.',
              ipAddress: actor.ip,
            });
            return h.response({
              success: false,
              code: 'INVALID_CURRENT_KEY',
              message: 'La clave actual proporcionada es incorrecta.',
            }).code(400);
          }

          // 2. La nueva clave no puede ser igual a la actual
          if (newKey === currentKey) {
            return h.response({
              success: false,
              code: 'SAME_KEY',
              message: 'La nueva clave no puede ser igual a la clave actual.',
            }).code(400);
          }

          // 2-bis. La clave nueva acaba en una linea del .env. Un salto de
          // linea dentro de ella la parte en dos y convierte el resto en otra
          // asignacion (ver assertWritablePair en utils/envFile.js). Se rechaza
          // AQUI, antes de re-cifrar nada: descubrirlo al escribir el archivo
          // dejaria las credenciales ya re-cifradas con una clave que solo
          // vive en memoria. estimateEntropy() no lo detecta por su cuenta.
          if (!isEnvSafeValue(newKey)) {
            return h.response({
              success: false,
              code: 'INVALID_KEY_FORMAT',
              message: 'La nueva Master Key no puede contener saltos de linea.',
            }).code(400);
          }

          // 3. Entropía de la nueva clave debe ser 'alta'
          if (estimateEntropy(newKey) !== 'alta') {
            return h.response({
              success: false,
              code: 'WEAK_KEY',
              message: 'La nueva Master Key no tiene suficiente entropía. Usa al menos 32 caracteres con mayúsculas, minúsculas, números y símbolos.',
            }).code(400);
          }

          // 4. Verificar que la clave actual coincide con el hash en BD
          const { rows: activeRows } = await query(
            `SELECT id, key_alias, key_hash, credentials_recrypted
             FROM sch_secret.tbl_master_config WHERE is_active = TRUE LIMIT 1`
          );
          const activeConfig = activeRows[0];
          if (!activeConfig) {
            return h.response({
              success: false,
              message: 'No se encontró configuración activa de Master Key en la base de datos.',
            }).code(500);
          }
          if (!verifyMasterKey(currentKey, activeConfig.key_hash)) {
            return h.response({
              success: false,
              code: 'KEY_MISMATCH',
              message: 'La clave en el servidor no coincide con el hash almacenado. Contacta al administrador del sistema.',
            }).code(400);
          }

          // 5. El .env debe ser escribible ANTES de re-cifrar nada (ver envWriteBlocker).
          const envBlocker = envWriteBlocker();
          if (envBlocker) {
            logger.error('rotate-key: el archivo .env no es escribible. Operación abortada antes de tocar la BD.', {
              code: envBlocker, path: ENV_PATH,
            });
            await auditRotation({
              actorId: actor.id, actorUsername: actor.username,
              action: AUDIT_ACTIONS.MASTER_KEY_ROTATION_FAIL,
              result: RESULT.FAIL,
              failReason: 'El archivo .env no es escribible.',
              ipAddress: actor.ip,
            });
            return h.response({
              success: false,
              code: 'ENV_NOT_WRITABLE',
              message: 'El archivo de configuración no es escribible. Corrige los permisos antes de rotar la clave.',
            }).code(500);
          }

          // --- Auditar inicio ---
          await auditRotation({
            actorId: actor.id, actorUsername: actor.username,
            action: AUDIT_ACTIONS.MASTER_KEY_ROTATION_START,
            result: RESULT.SUCCESS,
            ipAddress: actor.ip,
          });

          logger.warn('Iniciando rotación de Master Key.', { by: actor.username });

          // --- Transacción atómica ---
          let credentialsRecrypted = 0;
          let revokedSessionCount  = 0;
          try {
            await withTransaction(async (client) => {
              // El pool aplica statement_timeout=30s, pensado para las consultas
              // normales. Este UPDATE re-cifra TODAS las credenciales en una sola
              // sentencia, así que se le concede un límite propio: sin esto, un
              // almacén grande abortaría a mitad de una rotación legítima.
              await client.query("SET LOCAL statement_timeout = '600000'");

              // 0. Bloquear la clave activa antes de re-cifrar nada (ver
              //    lockActiveKeyRow): frena las escrituras de credenciales
              //    hasta el COMMIT y descarta una rotacion concurrente.
              await lockActiveKeyRow(client, activeConfig.id);

              // A. Re-cifrar todas las credenciales en una sola operación SQL.
              //    El plaintext NUNCA sale de PostgreSQL.
              //    $1 = oldKey, $2 = newKey
              //
              //    El filtro estado_registro = 'O' es correcto porque las
              //    credenciales eliminadas ya no guardan secreto: se purga en el
              //    borrado logico (migracion 008). Antes de eso, esas filas se
              //    quedaban cifradas con la clave vieja y quedaban ilegibles
              //    para siempre tras la primera rotacion.
              //    Las opciones de cifrado son las mismas que usa crypto.js al
              //    guardar una credencial nueva (AES-256 + S2K SHA-256). Sin
              //    ellas la rotacion habria reescrito con los defaults de
              //    pgcrypto y habria DEGRADADO a AES-128 lo que se cifro bien.
              //    Es tambien la via para migrar lo cifrado antes del cambio.
              const reencryptResult = await client.query(
                `UPDATE sch_secret.tbl_credentials
                 SET password_encrypted = pgp_sym_encrypt(
                       pgp_sym_decrypt(password_encrypted::bytea, $1::text)::text,
                       $2::text,
                       '${PGP_SYM_OPTIONS}'
                     ),
                     updated_at = NOW()
                 WHERE estado_registro = 'O'`,
                [currentKey, newKey]
              );
              credentialsRecrypted = reencryptResult.rowCount || 0;

              // A-bis. Secretos del segundo factor (migración 017): cifrados con
              //   la misma clave. Sin re-cifrarlos, tras la rotación nadie con
              //   segundo factor podría volver a entrar.
              await client.query(
                `UPDATE sch_system.tbl_users
                 SET mfa_secret_encrypted = pgp_sym_encrypt(
                       pgp_sym_decrypt(mfa_secret_encrypted::bytea, $1::text)::text,
                       $2::text,
                       '${PGP_SYM_OPTIONS}'
                     )
                 WHERE mfa_secret_encrypted IS NOT NULL`,
                [currentKey, newKey]
              );

              // B. Desactivar la clave anterior
              await client.query(
                `UPDATE sch_secret.tbl_master_config
                 SET is_active = FALSE, rotated_at = NOW()
                 WHERE is_active = TRUE`
              );

              // C. Insertar nueva entrada en el historial
              const versionNum = (activeConfig.key_alias.match(/\d+$/) || ['1'])[0];
              const newAlias = `master-key-v${parseInt(versionNum, 10) + 1}`;
              const newHash  = hashMasterKey(newKey);

              await client.query(
                `INSERT INTO sch_secret.tbl_master_config
                   (key_alias, key_hash, kms_provider, is_active, credentials_recrypted)
                 VALUES ($1, $2, 'LOCAL', TRUE, $3)`,
                [newAlias, newHash, credentialsRecrypted]
              );

              // D. Revocar todas las sesiones activas excepto la del admin que ejecutó la rotación.
              //    Dentro de la transacción: atómico con la rotación de clave.
              //    Cualquier sesión abierta antes de la rotación usaría la clave anterior en caché.
              const revokeResult = await client.query(
                `UPDATE sch_system.tbl_sessions
                 SET revoked = TRUE, revoked_at = NOW()
                 WHERE revoked = FALSE
                   AND expires_at > NOW()
                   AND id != $1`,
                [currentSessionId]
              );
              revokedSessionCount = revokeResult.rowCount || 0;
            });

            if (revokedSessionCount > 0) {
              logger.warn('Sesiones revocadas tras rotación de Master Key.', { revokedCount: revokedSessionCount, by: actor.username });
            }

            // --- Post-commit: actualizar .env y process.env ---
            // process.env primero: las requests en vuelo ya usan la nueva clave
            process.env.MASTER_KEY = newKey;

            // Luego .env (persistencia en reinicio)
            try {
              updateEnvMasterKey(newKey);
              logger.info('Archivo .env actualizado con nueva Master Key.');
            } catch (envErr) {
              // NO es fatal — el proceso ya tiene la clave nueva en memoria.
              // Pero es crítico: en el próximo reinicio la clave en .env no coincidirá.
              logger.error('CRÍTICO: No se pudo actualizar .env tras la rotación. Actualiza MASTER_KEY manualmente.', {
                code: envErr.code,
              });
            }

            await auditRotation({
              actorId: actor.id, actorUsername: actor.username,
              action: AUDIT_ACTIONS.MASTER_KEY_ROTATION_SUCCESS,
              result: RESULT.SUCCESS,
              ipAddress: actor.ip,
              credentialsRecrypted,
            });

            logger.warn('Rotación de Master Key completada.', {
              by: actor.username,
              credentialsRecrypted,
            });

            return {
              success: true,
              message: `Rotación completada. ${credentialsRecrypted} credencial(es) re-cifrada(s).`,
              credentials_recrypted: credentialsRecrypted,
            };
          } catch (err) {
            const conflicto = err.isRotationConflict === true;

            await auditRotation({
              actorId: actor.id, actorUsername: actor.username,
              action: AUDIT_ACTIONS.MASTER_KEY_ROTATION_FAIL,
              result: RESULT.FAIL,
              failReason: conflicto
                ? 'Otra rotación se confirmó mientras esta esperaba el bloqueo.'
                : 'Error durante la transacción de re-cifrado.',
              ipAddress: actor.ip,
            });

            // Nada que revertir: la transacción no llegó a tocar ninguna fila.
            if (conflicto) {
              logger.warn('Rotación de Master Key descartada: otra rotación terminó antes.', { by: actor.username });
              return h.response({
                success: false,
                code: 'ROTATION_CONFLICT',
                message: err.message,
              }).code(409);
            }

            logger.error('Rotación de Master Key FALLIDA — ROLLBACK ejecutado.', {
              by: actor.username,
              code: err.code,
            });

            throw err;
          }
        },
      },
    ]);
  },
};

// Se exporta para las pruebas: el orden de bloqueo con las escrituras de
// credenciales es lo que impide perder secretos durante una rotación.
module.exports.lockActiveKeyRow = lockActiveKeyRow;
module.exports.RotationConflictError = RotationConflictError;
