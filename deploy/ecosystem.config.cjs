'use strict';

// =============================================================================
// ecosystem.config.cjs — Proceso PM2 de Infra Credentials Manager
//
// Uso (desde la raíz del repositorio):
//   pm2 start deploy/ecosystem.config.cjs
//   pm2 save
//
// Los secretos NO van aquí: el backend los lee de backend/.env con dotenv.
// =============================================================================

const path = require('path');

module.exports = {
  apps: [
    {
      name: 'icm',
      script: 'src/app.js',

      // dotenv carga el .env relativo al directorio de trabajo, y LOG_DIR=./logs
      // también es relativo: el proceso tiene que arrancar dentro de backend/.
      cwd: path.resolve(__dirname, '../backend'),

      // Una sola instancia en modo fork. El rate limiting y los tokens de MFA ya
      // usados viven en memoria del proceso: en cluster cada worker llevaría su
      // propia cuenta y los límites se multiplicarían por el número de workers.
      exec_mode: 'fork',
      instances: 1,

      // El wizard y la rotación de claves reescriben backend/.env: con watch
      // activado PM2 reiniciaría el proceso a media operación.
      watch: false,

      // app.js hace el apagado ordenado con SIGTERM (server.stop con 10 s de
      // margen + cierre del pool). PM2 manda SIGINT por defecto y mata a los
      // 1,6 s; sin esto se cortarían peticiones en curso en cada reload.
      kill_signal: 'SIGTERM',
      kill_timeout: 15000,

      autorestart: true,
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 5000,
      max_memory_restart: '512M',

      time: true,

      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
