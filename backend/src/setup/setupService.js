'use strict';

const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { testConnection, withTransaction, resetPool } = require('../config/database');
const { runMigrations, runSeeds } = require('./migrationRunner');
const { markSetupCompleted, invalidateSetupToken } = require('./setupState');
const {
  hashMasterKey,
  generateMasterKey: _generateMasterKey,
  validatePasswordStrength,
  estimateEntropy,
} = require('../utils/crypto');
const { AUDIT_ACTIONS, RESULT } = require('../config/constants');
const { updateEnvFile } = require('../utils/envFile');
const logger = require('../utils/logger');

// =============================================================================
// setupService.js — Lógica de negocio del wizard de instalación.
//
// FLUJO DEL WIZARD (4 pasos):
//   Paso 0: Probar conexión a BD.
//   Paso 1: Validar/generar Master Key.
//   Paso 2: Datos del usuario administrador.
//   Paso 3: Confirmar e instalar (transacción atómica completa).
//
// stepFinalizeSetup es el paso más crítico: ejecuta migraciones, seeds,
// crea el usuario admin y el registro de master config en UNA transacción.
// Si cualquier operación falla → ROLLBACK → no se escribe el .env (que lleva
// SETUP_COMPLETED=true) ni el flag .installed: el wizard sigue abierto.
// =============================================================================

// Mapeo de códigos de error PG a mensajes amigables (sin revelar internos)
const PG_ERROR_MESSAGES = {
  '28P01':        'Credenciales de base de datos incorrectas.',
  '28000':        'Autenticación fallida.',
  '3D000':        'La base de datos especificada no existe.',
  '08001':        'No se pudo conectar al servidor de base de datos.',
  '08006':        'Conexión perdida con el servidor de base de datos.',
  '42501':        'El usuario no tiene permisos suficientes en la base de datos.',
  '53300':        'Límite de conexiones alcanzado (del usuario, de la base o del servidor). Revisa rolconnlimit, datconnlimit y max_connections.',
  '57P03':        'El servidor de base de datos aún no acepta conexiones (arrancando o en recuperación).',
  'ECONNREFUSED': null, // se construye con host:port abajo
  'ETIMEDOUT':    'Tiempo de espera agotado al conectar.',
  'ENOTFOUND':    'No se pudo resolver el nombre del host.',
  'EHOSTUNREACH': 'Host inalcanzable. Verifica la red y las rutas hacia el servidor.',
  'ECONNRESET':   'El servidor cerró la conexión. Revisa la opción SSL y pg_hba.conf.',
};

/**
 * Paso 0: Prueba la conexión a la base de datos.
 * Mapea errores técnicos a mensajes amigables.
 *
 * @param {{ host, port, name, user, password, ssl }} config
 * @returns {Promise<{ success: boolean, message: string }>}
 */
async function stepTestDatabase(config) {
  const result = await testConnection(config);

  if (result.success) {
    return { success: true, message: 'Conexión exitosa.' };
  }

  // Construir mensaje amigable
  let message = 'Error al conectar con la base de datos.';

  if (result.originalCode === 'ECONNREFUSED') {
    message = `No se pudo conectar a ${config.host}:${config.port}. Verifica que PostgreSQL esté ejecutándose.`;
  } else if (PG_ERROR_MESSAGES[result.originalCode]) {
    message = PG_ERROR_MESSAGES[result.originalCode];
  } else if (result.originalCode === 'ETIMEDOUT') {
    message = 'Tiempo de espera agotado. Verifica el host, puerto y firewall.';
  } else if (result.originalCode === 'ENOTFOUND') {
    message = `No se pudo resolver el host '${config.host}'. Verifica el nombre del servidor.`;
  } else if (result.originalCode) {
    // Código SQLSTATE o de red sin mensaje propio: se muestra para poder buscarlo.
    message = `Error al conectar con la base de datos (código ${result.originalCode}).`;
  } else if (result.timedOut) {
    message = 'Tiempo de espera agotado. Verifica el host, puerto y firewall.';
  }

  return { success: false, message };
}

/**
 * Paso 1: Valida la fortaleza y entropía de la Master Key.
 *
 * @param {{ masterKey: string }} param
 * @returns {{ success: boolean, entropy?: string, message?: string }}
 */
function stepValidateMasterKey({ masterKey }) {
  if (!masterKey || masterKey.length < 32) {
    return {
      success: false,
      message: 'La Master Key debe tener al menos 32 caracteres.',
    };
  }

  const entropy = estimateEntropy(masterKey);
  return { success: true, entropy };
}

/**
 * Genera una Master Key segura aleatoria.
 * @returns {{ masterKey: string, entropy: string }}
 */
function generateMasterKey() {
  const masterKey = _generateMasterKey();
  const entropy = estimateEntropy(masterKey);
  return { masterKey, entropy };
}

/**
 * Paso 3 (final): Ejecuta la instalación completa en transacción atómica.
 *
 * Operaciones en orden:
 *   1. Validar campos del adminUser
 *   2. runMigrations (dentro de la transacción)
 *   3. runSeeds (dentro de la transacción)
 *   4. INSERT tbl_master_config (solo hash, nunca la clave real)
 *   5. INSERT tbl_users (admin con bcrypt hash factor 14)
 *   6. INSERT tbl_audit_log (SETUP_COMPLETED)
 *   7. persistEnvConfig (solo bare-metal, ya fuera de la transacción)
 *   8. markSetupCompleted
 *   9. invalidateSetupToken
 *
 * Si CUALQUIER paso de la transacción falla → ROLLBACK → ni el .env ni el flag
 * .installed se escriben, así que el wizard sigue disponible para reintentar.
 *
 * @param {{ dbConfig, masterKey, adminUser }} params
 * @returns {Promise<{ success: boolean, message: string }>}
 */
async function stepFinalizeSetup({ dbConfig, masterKey, adminUser, appPort }) {
  // ----- Validación previa (fuera de transacción) ---------------------------

  const pwdValidation = validatePasswordStrength(adminUser.password);
  if (!pwdValidation.valid) {
    return { success: false, message: pwdValidation.message };
  }

  if (!masterKey || masterKey.length < 32) {
    return { success: false, message: 'La Master Key no es válida.' };
  }

  // Exigir entropía alta, igual que la rotación de clave (security.routes.js).
  // Evita instalar el sistema con una clave débil (p. ej. 32 caracteres repetidos).
  if (estimateEntropy(masterKey) !== 'alta') {
    return {
      success: false,
      message: 'La Master Key no tiene suficiente entropía. Usa al menos 32 caracteres combinando mayúsculas, minúsculas, números y símbolos (o usa el generador automático del asistente).',
    };
  }

  if (!adminUser.username || !adminUser.email || !adminUser.fullName) {
    return { success: false, message: 'Faltan datos del usuario administrador.' };
  }

  // ----- Transacción atómica ------------------------------------------------
  // Usa dbConfig directamente (pool temporal) para no depender del pool
  // singleton, que puede tener credenciales viejas o vacías en memoria.
  try {
    await withTransaction(async (client) => {
      // a) Ejecutar migraciones SQL
      logger.info('Ejecutando migraciones de base de datos...');
      await runMigrations(client);

      // b) Ejecutar seeds de catálogos base
      logger.info('Ejecutando seeds de catálogos...');
      await runSeeds(client);

      // c) Registrar Master Key (SOLO hash SHA-256, nunca la clave real)
      const keyHash = hashMasterKey(masterKey);
      await client.query(
        `INSERT INTO sch_secret.tbl_master_config
           (key_alias, key_hash, kms_provider, is_active, credentials_recrypted)
         VALUES ($1, $2, $3, $4, $5)`,
        ['primary', keyHash, 'LOCAL', true, 0]
      );
      logger.info('Master Key registrada en tbl_master_config (solo hash).');

      // d) Obtener el ID del rol ADMIN
      const { rows: roleRows } = await client.query(
        `SELECT id FROM sch_system.tbl_roles
         WHERE code = 'ADMIN' AND estado_registro = 'O'
         LIMIT 1`
      );
      if (roleRows.length === 0) {
        throw new Error('Rol ADMIN no encontrado. Las seeds pueden no haberse aplicado.');
      }
      const adminRoleId = roleRows[0].id;

      // e) Crear usuario administrador con bcrypt hash factor 14
      // factor 14 = 2^14 iteraciones bcrypt (seguro y razonable para admin)
      logger.info('Generando hash de contraseña del administrador (bcrypt f14)...');
      const passwordHash = await bcrypt.hash(adminUser.password, 14);

      await client.query(
        `INSERT INTO sch_system.tbl_users
           (username, email, full_name, password_hash, role_id, team_id,
            force_pwd_change, estado_registro, estado)
         VALUES ($1, $2, $3, $4, $5, NULL, FALSE, 'O', 'AI')`,
        [
          adminUser.username.trim(),
          adminUser.email.trim().toLowerCase(),
          adminUser.fullName.trim(),
          passwordHash,
          adminRoleId,
        ]
      );
      logger.info('Usuario administrador creado.', { username: adminUser.username });

      // f) Registrar el evento en auditoría
      await client.query(
        `INSERT INTO sch_audit.tbl_audit_log
           (action, resource_type, result, extra_data)
         VALUES ($1, $2, $3, $4)`,
        [
          AUDIT_ACTIONS.SETUP_COMPLETED,
          'SYS',
          RESULT.SUCCESS,
          JSON.stringify({ admin_username: adminUser.username }),
        ]
      );
    }, dbConfig);

    // ----- Post-transacción (éxito) ------------------------------------------

    // Persistir .env DESPUÉS de la transacción. El archivo incluye
    // SETUP_COMPLETED=true, así que escribirlo antes dejaba el wizard cerrado
    // tras un reinicio cuando la instalación fallaba: el operador se encontraba
    // el login contra una base de datos a medio instalar y sin forma de
    // reintentar. La transacción no necesita el .env: withTransaction recibe
    // dbConfig y abre un pool temporal con esos datos.
    // Si DOCKER_ENV está activo, las vars ya están inyectadas por el contenedor.
    let envPersisted = true;
    if (process.env.DOCKER_ENV !== 'true') {
      try {
        await persistEnvConfig(dbConfig, masterKey, appPort);
      } catch (err) {
        // La BD ya está instalada y no hay marcha atrás, así que no se convierte
        // en un fallo de la instalación: se avisa de forma accionable, igual que
        // hace markSetupCompleted cuando no puede escribir el flag .installed.
        envPersisted = false;
        logger.error(
          'CRÍTICO: La instalación terminó correctamente pero no se pudo escribir ' +
          'backend/.env. Acción requerida: añádele a mano los datos de conexión a ' +
          'la base de datos, la Master Key (tal como la introdujiste en el asistente) ' +
          'y SETUP_COMPLETED=true. Sin la Master Key el sistema no podrá descifrar ' +
          'las credenciales que se guarden.',
          { errorCode: err.code }
        );
        process.stdout.write(
          '\n⚠  ACCIÓN REQUERIDA: no se pudo escribir backend/.env.\n' +
          '   Añádele a mano DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD,\n' +
          '   MASTER_KEY (la del asistente) y SETUP_COMPLETED=true.\n\n'
        );
      }
    }

    // Recargar .env y resetear pool para que los requests siguientes
    // (login, etc.) usen las credenciales recién escritas sin reiniciar.
    if (envPersisted) {
      require('dotenv').config({ override: true });
      await resetPool();
    }

    // Marcar el sistema como instalado
    markSetupCompleted({ admin_user: adminUser.username });
    invalidateSetupToken();

    logger.info('Instalación completada exitosamente.', { admin: adminUser.username });
    return {
      success: true,
      message: envPersisted
        ? 'Sistema instalado correctamente.'
        : 'Sistema instalado, pero no se pudo escribir backend/.env. Revisa los logs ' +
          'del servidor: hay que completarlo a mano antes de reiniciar.',
    };

  } catch (err) {
    // NUNCA exponer el error real al cliente en producción
    logger.error('Error en stepFinalizeSetup:', {
      code: err.code,
      message: process.env.NODE_ENV !== 'production' ? err.message : '[omitido]',
    });
    return {
      success: false,
      message: 'Error durante la instalación. Revisa los logs del servidor para más detalles.',
    };
  }
}

/**
 * Persiste la configuración de BD y la Master Key en el archivo .env.
 * SOLO se ejecuta en modo bare-metal (DOCKER_ENV !== 'true').
 *
 * Lee el .env existente, actualiza o agrega cada clave, y lo re-escribe.
 * Preserva las líneas existentes que no correspondan a las claves a escribir.
 *
 * ADVERTENCIA DE SEGURIDAD: el archivo .env debe tener permisos 600 (solo owner).
 * El wizard no puede cambiar permisos del sistema de archivos del host.
 *
 * @param {object} dbConfig - { host, port, name, user, password, ssl }
 * @param {string} masterKey
 */
async function persistEnvConfig(dbConfig, masterKey, appPort) {
  const envPath        = path.resolve(__dirname, '../../.env');
  const envExamplePath = path.resolve(__dirname, '../../.env.example');

  // Si no existe .env, copiar desde .env.example como base
  if (!fs.existsSync(envPath)) {
    try {
      fs.copyFileSync(envExamplePath, envPath);
      logger.info('Archivo .env creado desde .env.example.');
    } catch (err) {
      logger.warn('No se pudo copiar .env.example; se creará .env desde cero.', { error: err.code });
    }
  }

  const port = parseInt(appPort, 10) || 8743;

  // Generar JWT_SECRET solo si no existe ya uno válido en el .env actual
  const existingJwtSecret = process.env.JWT_SECRET || '';
  const isPlaceholder = existingJwtSecret.includes('CHANGE_ME') || existingJwtSecret.length < 64;
  const jwtSecret = isPlaceholder
    ? require('crypto').randomBytes(64).toString('hex')
    : existingJwtSecret;

  // Variables a escribir/actualizar en backend/.env
  const updates = {
    APP_PORT:         String(port),
    DB_HOST:          String(dbConfig.host),
    DB_PORT:          String(dbConfig.port || 5432),
    DB_NAME:          String(dbConfig.name),
    DB_USER:          String(dbConfig.user),
    DB_PASSWORD:      String(dbConfig.password),
    DB_SSL:           dbConfig.ssl ? 'true' : 'false',
    JWT_SECRET:       jwtSecret,
    MASTER_KEY:       String(masterKey),
    SETUP_COMPLETED:  'true',
  };

  // Escritura atomica con modo 0600. De las tres variables mas sensibles del
  // sistema —MASTER_KEY, JWT_SECRET y DB_PASSWORD— esta es la unica escritura
  // que las fija todas a la vez: una interrupcion a media escritura dejaria la
  // instalacion sin clave con la que descifrar lo que se cifre despues.
  updateEnvFile(envPath, updates, {
    mode: 0o600, // Sólo owner puede leer/escribir (Linux/macOS; en Windows no aplica)
    sectionComment: '# Generado por el wizard de instalación',
  });
  logger.info('Archivo .env actualizado con configuración de instalación.');

  // Escribir frontend/.env con la URL del backend para el proxy de Vite
  const frontendEnvPath = path.resolve(__dirname, '../../../frontend/.env');
  const frontendEnvContent = `# Generado por el wizard de instalación. No editar manualmente.\nVITE_API_URL=http://localhost:${port}\n`;
  try {
    fs.writeFileSync(frontendEnvPath, frontendEnvContent, 'utf8');
    logger.info('Archivo frontend/.env actualizado.', { port });
  } catch (err) {
    logger.warn('No se pudo escribir frontend/.env.', { error: err.code });
  }
}

module.exports = {
  stepTestDatabase,
  stepValidateMasterKey,
  generateMasterKey,
  stepFinalizeSetup,
  persistEnvConfig,
};
