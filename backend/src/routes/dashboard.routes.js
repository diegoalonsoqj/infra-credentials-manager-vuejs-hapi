'use strict';

const repo = require('../repositories/dashboard.repository');
const { ROLE_LEVELS, PERMISSIONS } = require('../config/constants');

// =============================================================================
// dashboard.routes.js — Estadísticas del Dashboard. Prefijo /api/dashboard.
//
// GET /api/dashboard/stats
//   Devuelve KPIs de credenciales, actividad reciente y distribución por ambiente.
//   ADMIN ve todos los datos; usuarios de equipo ven solo su ámbito de tipos.
//
// AMBITO — esta ruta solo exige sesión, así que la acota cada consulta:
//   - Credenciales (KPIs y desglose por ambiente): por los tipos de recurso del
//     equipo. null solo para ADMIN; el array vacío significa ninguno.
//   - Actividad reciente: el log completo únicamente con MOD_AUDIT, que es el
//     permiso que protege GET /api/audit. Sin él, solo la actividad propia.
//     Las tres consultas ignoraban el ámbito salvo los KPIs, de modo que este
//     endpoint entregaba a cualquier sesión —VISITOR incluido— el rastro de
//     quién descifró qué credencial y sobre qué recurso productivo.
// =============================================================================

module.exports = {
  name: 'icm-routes-dashboard',
  register(server) {
    server.route({
      method: 'GET',
      path: '/stats',
      options: { auth: 'session' },
      handler: async (request) => {
        const user          = request.auth.credentials;
        const isAdmin       = (user.level || 0) >= ROLE_LEVELS.ADMIN;
        const resourceTypes = isAdmin ? null : (user.teamResourceTypes || []);
        const veTodoElLog   = (user.permissions || []).includes(PERMISSIONS.MOD_AUDIT);

        const [stats, recentActivity, byEnvironment] = await Promise.all([
          repo.getCredentialStats(resourceTypes),
          repo.getRecentActivity(8, veTodoElLog ? null : user.id),
          repo.getCredentialsByEnvironment(resourceTypes),
        ]);

        // El frontend no puede deducir el ambito de la lista mirandola, y una
        // lista recortada bajo el titulo "Actividad Reciente" se lee como si no
        // hubiera pasado nada mas en el sistema. Se dice explicitamente.
        return {
          success: true,
          stats,
          recentActivity,
          recentActivityScope: veTodoElLog ? 'all' : 'own',
          byEnvironment,
        };
      },
    });
  },
};
