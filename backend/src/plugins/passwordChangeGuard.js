'use strict';

// =============================================================================
// plugins/passwordChangeGuard.js — Cambio de contraseña obligatorio.
//
// Cuando un ADMIN resetea la contraseña de un usuario, tbl_users.force_pwd_change
// queda a TRUE y el usuario recibe una contraseña provisional. Esa marca no
// obligaba a nada: la contraseña temporal servía indefinidamente y daba acceso
// completo, incluido el descifrado de credenciales. El único rastro en el
// frontend era un aviso en la página de perfil.
//
// Con este guard, una sesión marcada solo puede hacer lo imprescindible para
// salir del estado: saber quién es, ver su perfil, cambiar la contraseña y
// cerrar sesión. Todo lo demás responde 403 PASSWORD_CHANGE_REQUIRED, código que
// el frontend usa para redirigir al perfil.
//
// Se ejecuta en onPostAuth porque necesita las credenciales ya resueltas. Las
// rutas sin autenticación (health, wizard, login) no traen credenciales y pasan
// de largo.
// =============================================================================

// Método + ruta exactos. El enrutador ya normalizó la barra final
// (stripTrailingSlash) y distingue mayúsculas, así que la comparación textual
// es suficiente y no admite variantes.
const ALLOWED = [
  'GET /api/auth/me',
  'POST /api/auth/logout',
  'GET /api/profile',
  'GET /api/profile/sessions',   // la pagina de perfil la carga junto con /profile
  'POST /api/profile/change-password',
];

const plugin = {
  name: 'icm-password-change-guard',
  register(server) {
    server.ext('onPostAuth', (request, h) => {
      const user = request.auth.credentials;
      if (!user || user.forcePwdChange !== true) return h.continue;

      if (ALLOWED.includes(`${request.method.toUpperCase()} ${request.path}`)) {
        return h.continue;
      }

      return h.response({
        success: false,
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'Debes cambiar tu contraseña antes de continuar.',
      }).code(403).takeover();
    });
  },
};

module.exports = plugin;
module.exports.ALLOWED = ALLOWED;
