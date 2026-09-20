'use strict';

// =============================================================================
// migrate.js — Aplica las migraciones pendientes a una instalación existente.
//
// Uso (desde la carpeta backend/):
//   npm run migrate          → aplica lo que falte
//   npm run migrate -- --dry → solo informa de lo pendiente, sin tocar nada
//
// POR QUÉ EXISTE
// El wizard de instalación ejecuta las migraciones una única vez, al completar
// el `finalize`. Nada las vuelve a ejecutar al arrancar, así que una migración
// añadida después de instalar no llega sola a la base de datos.
//
// Usa el mismo runner que el wizard (src/setup/migrationRunner), de modo que
// cada archivo queda registrado en sch_system.tbl_migrations con su checksum.
// Aplicar el SQL a mano rompería esa verificación de integridad: el runner
// aborta si un archivo ya aplicado cambia de contenido.
// =============================================================================

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const fs = require('fs');

const { runMigrations, checksumFile } = require('../src/setup/migrationRunner');
const { query, closePool } = require('../src/config/database');

const MIGRATIONS_DIR = path.resolve(__dirname, '../../database/migrations');

/** Archivos .sql del directorio de migraciones, ordenados por nombre. */
function migrationFiles() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

function checksumOf(filename) {
  return checksumFile(path.join(MIGRATIONS_DIR, filename));
}

/**
 * Estado de cada migración respecto a la base de datos.
 * Devuelve null si la tabla de control no existe (sistema sin instalar).
 */
async function inspect() {
  let applied;
  try {
    const { rows } = await query(
      'SELECT filename, checksum FROM sch_system.tbl_migrations'
    );
    applied = new Map(rows.map((r) => [r.filename, r.checksum]));
  } catch (err) {
    if (err.code === '42P01' || err.code === '3F000') return null; // tabla o esquema inexistente
    throw err;
  }

  const pendientes = [];
  const modificadas = [];

  for (const filename of migrationFiles()) {
    const actual = applied.get(filename);
    if (!actual) pendientes.push(filename);
    else if (actual !== checksumOf(filename)) modificadas.push(filename);
  }

  return { total: applied.size, pendientes, modificadas };
}

async function main() {
  const dryRun = process.argv.includes('--dry');
  const estado = await inspect();

  if (estado === null) {
    console.error(
      '\n✗ No existe sch_system.tbl_migrations: el sistema no está instalado.\n' +
      '  Completa primero el wizard de instalación, que aplica migraciones,\n' +
      '  seeds, la Master Key y el usuario administrador.\n'
    );
    process.exitCode = 1;
    return;
  }

  if (estado.modificadas.length > 0) {
    console.error(
      '\n✗ INTEGRIDAD: estos archivos cambiaron después de aplicarse:\n' +
      estado.modificadas.map((f) => `    - ${f}`).join('\n') +
      '\n  Una migración ya aplicada no debe editarse: crea una nueva.\n'
    );
    process.exitCode = 1;
    return;
  }

  console.log(`\nMigraciones aplicadas: ${estado.total}`);

  if (estado.pendientes.length === 0) {
    console.log('✓ No hay migraciones pendientes.\n');
    return;
  }

  console.log(`Pendientes (${estado.pendientes.length}):`);
  estado.pendientes.forEach((f) => console.log(`    - ${f}`));

  if (dryRun) {
    console.log('\n(--dry: no se aplicó nada)\n');
    return;
  }

  console.log('\nAplicando...');
  await runMigrations();
  console.log('\n✓ Migraciones aplicadas.\n');
}

main()
  .catch((err) => {
    console.error('\n✗ Error:', err.message, '\n');
    process.exitCode = 1;
  })
  .finally(() => closePool().catch(() => {}));
