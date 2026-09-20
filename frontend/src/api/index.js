import axios from 'axios'

// =============================================================================
// api/index.js — Instancia axios configurada con interceptores.
//
// INTERCEPTOR REQUEST: no hace nada. El token de sesion viaja en una cookie
//   HttpOnly que el navegador adjunta solo con withCredentials; JavaScript no
//   puede leerlo ni escribirlo, que es justo la proteccion que se busca.
// INTERCEPTOR RESPONSE:
//   - 401 → limpiar sesión y redirigir a /login
//   - 503 SETUP_REQUIRED → redirigir a /setup
//   - Éxito: retorna res.data directamente
//   - Error: retorna Promise.reject con el payload estructurado
//
// SEGURIDAD: el token NO se almacena en el navegador. Vive en la cookie
// HttpOnly icm_session (SameSite=Strict, Secure en produccion), fuera del
// alcance de JavaScript. En sessionStorage solo se guarda el perfil del usuario
// (nombre, rol, permisos) para pintar la interfaz tras una recarga; el servidor
// nunca confia en ese dato: revalida rol y permisos contra la base de datos en
// cada peticion.
// =============================================================================

// Bandera para evitar múltiples redirecciones cuando varias peticiones
// fallan con 401 simultáneamente. Se resetea sola al recargar la página.
let _redirectingToLogin = false

const api = axios.create({
  baseURL:         '/api',
  timeout:         30000, // 30s para operaciones largas (wizard finalize, key rotation)
  withCredentials: true,  // Enviar cookie HttpOnly en cada request
  headers: {
    'Content-Type': 'application/json',
  },
})

// ---------------------------------------------------------------------------
// Interceptor de REQUEST — sin inyección de token (lo gestiona la cookie)
// ---------------------------------------------------------------------------
api.interceptors.request.use(
  (config) => config,
  (error) => Promise.reject(error)
)

// ---------------------------------------------------------------------------
// Interceptor de RESPONSE — manejo centralizado de errores
// ---------------------------------------------------------------------------
api.interceptors.response.use(
  // Respuesta exitosa: retornar solo data (sin el wrapper de axios)
  (response) => response.data,

  // Error HTTP
  (error) => {
    const status = error.response?.status
    const data   = error.response?.data

    // 401 — Sesión expirada o cookie inválida
    if (status === 401) {
      sessionStorage.removeItem('icm_user')
      // Cerrada por inactividad (session_idle_minutes): se distingue para poder
      // decírselo al usuario en el login en vez de dejarle adivinando.
      const destino = data?.code === 'SESSION_IDLE' ? '/login?motivo=inactividad' : '/login'
      // Solo redirigir una vez aunque múltiples peticiones fallen con 401
      // simultáneamente. La bandera se resetea sola al recargar la página.
      if (!_redirectingToLogin &&
          !window.location.pathname.startsWith('/login') &&
          !window.location.pathname.startsWith('/setup')) {
        _redirectingToLogin = true
        window.location.href = destino
      }
      return Promise.reject(data || { message: 'Sesión expirada. Inicia sesión nuevamente.' })
    }

    // 403 PASSWORD_CHANGE_REQUIRED — el backend exige cambiar la contraseña
    // provisional antes de permitir cualquier otra operación. Ocurre con los
    // usuarios recién creados y tras un reseteo hecho por un administrador.
    if (status === 403 && data?.code === 'PASSWORD_CHANGE_REQUIRED') {
      if (!window.location.pathname.startsWith('/profile')) {
        window.location.href = '/profile'
      }
      return Promise.reject(data)
    }

    // 403 MFA_ENROLLMENT_REQUIRED — la política exige segundo factor y el
    // usuario aún no lo ha activado: solo puede hacerlo desde su perfil.
    if (status === 403 && data?.code === 'MFA_ENROLLMENT_REQUIRED') {
      if (!window.location.pathname.startsWith('/profile')) {
        window.location.href = '/profile'
      }
      return Promise.reject(data)
    }

    // 503 SETUP_REQUIRED — Sistema no instalado
    if (status === 503 && data?.code === 'SETUP_REQUIRED') {
      if (!window.location.pathname.startsWith('/setup')) {
        window.location.href = '/setup'
      }
      return Promise.reject(data)
    }

    // Otros errores: retornar el payload del servidor o un mensaje genérico
    return Promise.reject(data || { message: 'Error de conexión con el servidor.' })
  }
)

// ---------------------------------------------------------------------------
// setupApi — Métodos del wizard de instalación
// ---------------------------------------------------------------------------

// Token temporal del wizard. Lo ingresa el operador desde los logs del servidor.
let _setupToken = null

function setupHeaders() {
  return _setupToken ? { 'x-setup-token': _setupToken } : {}
}

export const setupApi = {
  /** Guarda el token del wizard para incluirlo en todas las llamadas siguientes */
  setToken: (token) => { _setupToken = token },

  /** Verifica si el sistema está instalado (sin token — siempre accesible) */
  getStatus:    ()     => api.get('/setup/status'),

  /** Genera una Master Key segura aleatoria */
  generateKey:  ()     => api.get('/setup/generate-key', { headers: setupHeaders() }),

  /** Prueba la conexión a la base de datos (Paso 0) */
  testDatabase: (data) => api.post('/setup/test-db', data, { headers: setupHeaders() }),

  /** Valida la fortaleza de la Master Key (Paso 1) */
  validateKey:  (data) => api.post('/setup/validate-key', data, { headers: setupHeaders() }),

  /** Ejecuta la instalación completa (Paso 3) */
  finalize:     (data) => api.post('/setup/finalize', data, { headers: setupHeaders() }),
}

export default api
