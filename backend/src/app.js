'use strict';

const { start, PORT, HOST } = require('./server');
const logger = require('./utils/logger');
const { isSetupCompleted, getSetupToken } = require('./setup/setupState');

// =============================================================================
// app.js — Punto de entrada del proceso.
//
// La construcción del servidor vive en server.js (reutilizable desde los tests
// con server.inject()); aquí solo queda el arranque, el aviso del wizard y el
// apagado ordenado.
// =============================================================================

/**
 * Muestra el token del wizard cuando el sistema aún no está instalado.
 * El token se imprime SOLO en stdout (no en archivos de log) para evitar que
 * quede expuesto en sistemas de centralización de logs (ELK, CloudWatch, etc.).
 */
function announceSetupWizard() {
  const setupToken = getSetupToken();

  logger.warn('SISTEMA NO INSTALADO — Wizard de instalación activo.');
  logger.warn(`URL del wizard: http://localhost:${PORT}/api/setup/status`);
  logger.warn('Abre el frontend y completa el wizard para iniciar.');

  process.stdout.write('\n' + '═'.repeat(70) + '\n');
  process.stdout.write('  SETUP TOKEN (solo visible aquí — no queda en logs)\n');
  process.stdout.write(`  ${setupToken}\n`);
  process.stdout.write('═'.repeat(70) + '\n\n');
}

async function main() {
  const server = await start();

  if (!isSetupCompleted()) {
    announceSetupWizard();
  } else {
    logger.info('✓ infra-credentials-manager iniciado.', {
      url: `http://${HOST}:${PORT}`,
      env: process.env.NODE_ENV,
    });
  }

  // Shutdown graceful
  process.on('SIGTERM', async () => {
    logger.info('SIGTERM recibido. Cerrando servidor...');
    await server.stop({ timeout: 10000 });
    const { closePool } = require('./config/database');
    await closePool();
    process.exit(0);
  });
}

main().catch((err) => {
  logger.error('No se pudo iniciar el servidor.', { message: err.message, code: err.code });
  process.exit(1);
});
