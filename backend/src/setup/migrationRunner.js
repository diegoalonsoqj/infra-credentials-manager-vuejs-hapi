'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { withTransaction } = require('../config/database');

// =============================================================================
// migrationRunner.js — Ejecutor idempotente de migraciones SQL.
//
// Funcionamiento:
// - Lee archivos .sql del directorio /database/migrations ordenados por nombre.
// - Por cada archivo calcula un checksum SHA-256.
// - Si ya fue aplicado con el mismo checksum: SKIP (idempotente).
// - Si fue aplicado con checksum DIFERENTE: ERROR CRÍTICO (integridad violada).
// - Si es nuevo: ejecuta el SQL e inserta en tbl_migrations.
//
// SEGURIDAD: Un checksum distinto en una migración ya aplicada indica que
// el archivo fue modificado después de su aplicación, lo cual es una violación
// crítica de integridad que debe detenerse inmediatamente.
// =============================================================================

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../database/migrations');
const SEEDS_DIR      = path.resolve(__dirname, '../../../database/seeds');

/**
 * Calcula el SHA-256 hex del contenido de un archivo.
 * @param {string} filePath
 * @returns {string} SHA-256 hex
 */
function checksumFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  // Se normalizan los finales de linea antes de calcular el hash. El checksum
  // debe detectar cambios de CONTENIDO, no de formato: en Windows, git con
  // core.autocrlf=true escribe CRLF al hacer checkout, de modo que un clon
  // nuevo del repositorio producia un hash distinto al registrado en la
  // instalacion y el runner abortaba con INTEGRIDAD VIOLADA, bloqueando
  // cualquier migracion posterior. Los checksums ya almacenados se calcularon
  // sobre contenido con LF, asi que esta normalizacion coincide con ellos.
  return crypto.createHash('sha256').update(content.replace(/\r\n/g, '\n')).digest('hex');
}

/**
 * Ejecuta una lista de archivos SQL sobre un cliente.
 * Usa SAVEPOINTs para evitar que queries fallidas aborten la transacción completa.
 * Esto es necesario porque en la primera ejecución tbl_migrations no existe aún.
 *
 * @param {import('pg').PoolClient} client
 * @param {string[]} files - Rutas absolutas de archivos SQL.
 * @param {string} label   - Etiqueta para logging (ej: 'migración', 'seed').
 */
async function applyFiles(client, files, label = 'archivo') {
  // Leer migraciones ya aplicadas usando SAVEPOINT para no abortar la transacción
  // si tbl_migrations todavía no existe (primera ejecución).
  let applied = {};
  await client.query('SAVEPOINT read_migrations');
  try {
    const { rows } = await client.query(
      'SELECT filename, checksum FROM sch_system.tbl_migrations'
    );
    applied = rows.reduce((acc, row) => {
      acc[row.filename] = row.checksum;
      return acc;
    }, {});
    await client.query('RELEASE SAVEPOINT read_migrations');
  } catch {
    // tbl_migrations no existe aún — primera ejecución. Revertir al savepoint
    // para que la transacción siga válida.
    await client.query('ROLLBACK TO SAVEPOINT read_migrations');
    await client.query('RELEASE SAVEPOINT read_migrations');
  }

  for (const filePath of files) {
    const filename = path.basename(filePath);
    const checksum = checksumFile(filePath);

    if (applied[filename]) {
      // Ya aplicado: verificar integridad del checksum
      if (applied[filename] !== checksum) {
        throw new Error(
          `INTEGRIDAD VIOLADA: El ${label} '${filename}' fue modificado ` +
          `después de su aplicación. Checksum esperado: ${applied[filename]}, ` +
          `checksum actual: ${checksum}. El sistema no puede continuar.`
        );
      }
      logger.debug(`${label} ya aplicado, omitiendo: ${filename}`);
      continue;
    }

    // Aplicar el SQL
    logger.info(`Aplicando ${label}: ${filename}`);
    const sql = fs.readFileSync(filePath, 'utf8');
    await client.query(sql);

    // Registrar en tbl_migrations usando SAVEPOINT por si la tabla acaba
    // de crearse en esta misma ejecución (001_ la crea).
    await client.query('SAVEPOINT insert_migration');
    try {
      await client.query(
        `INSERT INTO sch_system.tbl_migrations (filename, checksum)
         VALUES ($1, $2) ON CONFLICT (filename) DO NOTHING`,
        [filename, checksum]
      );
      await client.query('RELEASE SAVEPOINT insert_migration');
    } catch {
      await client.query('ROLLBACK TO SAVEPOINT insert_migration');
      await client.query('RELEASE SAVEPOINT insert_migration');
    }

    logger.info(`${label} aplicado: ${filename}`);
  }
}

/**
 * Ejecuta todas las migraciones pendientes.
 * Si se pasa un client externo, lo usa (para transacciones del wizard).
 * Si no, crea su propia transacción.
 *
 * @param {import('pg').PoolClient} [externalClient]
 */
async function runMigrations(externalClient = null) {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    throw new Error(`Directorio de migraciones no encontrado: ${MIGRATIONS_DIR}`);
  }

  const migrationFiles = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .map(f => path.join(MIGRATIONS_DIR, f));

  if (migrationFiles.length === 0) {
    logger.warn('No se encontraron archivos de migración.');
    return;
  }

  logger.info(`Ejecutando ${migrationFiles.length} archivo(s) de migración.`);

  const execute = async (client) => {
    // La primera migración crea la tabla de control; necesitamos crearla antes
    // si no existe para poder registrar las migraciones.
    // Como el SQL 001_ ya tiene CREATE TABLE IF NOT EXISTS, solo necesitamos
    // asegurar que el schema exista primero.
    await client.query('CREATE SCHEMA IF NOT EXISTS sch_system');
    await client.query('CREATE SCHEMA IF NOT EXISTS sch_secret');
    await client.query('CREATE SCHEMA IF NOT EXISTS sch_audit');

    // Ejecutar migraciones (001_schemas_and_extensions crea tbl_migrations)
    await applyFiles(client, migrationFiles, 'migración');
  };

  if (externalClient) {
    await execute(externalClient);
  } else {
    await withTransaction(execute);
  }

  logger.info('Migraciones completadas.');
}

/**
 * Ejecuta los seeds base.
 * Idempotente por el ON CONFLICT DO NOTHING en los seeds.
 *
 * @param {import('pg').PoolClient} [externalClient]
 */
async function runSeeds(externalClient = null) {
  if (!fs.existsSync(SEEDS_DIR)) {
    logger.warn(`Directorio de seeds no encontrado: ${SEEDS_DIR}`);
    return;
  }

  const seedFiles = fs
    .readdirSync(SEEDS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .map(f => path.join(SEEDS_DIR, f));

  if (seedFiles.length === 0) {
    logger.warn('No se encontraron archivos de seeds.');
    return;
  }

  logger.info(`Ejecutando ${seedFiles.length} archivo(s) de seeds.`);

  const execute = async (client) => {
    for (const filePath of seedFiles) {
      const filename = path.basename(filePath);
      logger.info(`Aplicando seed: ${filename}`);
      const sql = fs.readFileSync(filePath, 'utf8');
      await client.query(sql);
      logger.info(`Seed aplicado: ${filename}`);
    }
  };

  if (externalClient) {
    await execute(externalClient);
  } else {
    await withTransaction(execute);
  }

  logger.info('Seeds completados.');
}

module.exports = {
  runMigrations,
  runSeeds,
  // Se exporta para que scripts/migrate.js calcule el checksum exactamente
  // igual que el runner y no puedan divergir.
  checksumFile,
};
