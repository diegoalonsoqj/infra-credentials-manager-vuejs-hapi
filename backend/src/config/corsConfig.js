'use strict';

// =============================================================================
// corsConfig.js — Configuración CORS mutable en tiempo de ejecución.
//
// Se inicializa desde la variable de entorno CORS_ORIGIN al arrancar.
// El panel de administración (PUT /api/system/settings/cors_origin) puede
// actualizar corsConfig.origin sin reiniciar el servidor.
//
// NOTA: Este valor se pierde al reiniciar el proceso. Para persistencia
// permanente, también actualizar CORS_ORIGIN en el archivo .env.
// =============================================================================

module.exports = {
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
};
