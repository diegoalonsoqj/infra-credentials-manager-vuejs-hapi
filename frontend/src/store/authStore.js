import { defineStore } from 'pinia'

// =============================================================================
// authStore.js — Estado de autenticación global (Pinia).
//
// Aqui NO hay token: el JWT viaja exclusivamente en la cookie HttpOnly
// icm_session y JavaScript no puede leerlo. En sessionStorage solo se guarda el
// perfil (icm_user) para reconstruir la interfaz tras una recarga.
//
// NUNCA usar localStorage: ese perfil no debe sobrevivir al cierre del
// navegador, porque dejaria la interfaz creyendo que hay sesion cuando la
// cookie ya expiro.
//
// user.permissions: array de códigos de permiso del rol del usuario.
//   Ej: ['MOD_PWDGEN', 'CRED_VIEW', 'RES_VIEW']
// =============================================================================

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null,
    isAuthenticated: false,
  }),

  actions: {
    /**
     * Iniciar sesión: guardar datos del usuario en sessionStorage.
     * El token JWT viaja exclusivamente en cookie HttpOnly — nunca en JS.
     */
    login(userData) {
      sessionStorage.setItem('icm_user', JSON.stringify(userData))
      this.user = userData
      this.isAuthenticated = true
    },

    /**
     * Cerrar sesión: limpiar sessionStorage y resetear estado.
     */
    logout() {
      sessionStorage.removeItem('icm_user')
      this.user = null
      this.isAuthenticated = false
    },

    /**
     * Restaurar sesión desde sessionStorage (llamar al arrancar la app).
     */
    init() {
      const userRaw = sessionStorage.getItem('icm_user')
      if (userRaw) {
        try {
          const user = JSON.parse(userRaw)
          this.user = user
          this.isAuthenticated = true
        } catch {
          sessionStorage.removeItem('icm_user')
        }
      }
    },

    /**
     * Actualizar datos del usuario en memoria (ej: cambio de perfil).
     */
    updateUser(data) {
      const updated = { ...this.user, ...data }
      sessionStorage.setItem('icm_user', JSON.stringify(updated))
      this.user = updated
    },

    /**
     * Verifica si el usuario tiene un permiso específico.
     */
    hasPermission(permissionCode) {
      if (!this.user) return false
      return (this.user.permissions || []).includes(permissionCode)
    },

    // -------------------------------------------------------------------------
    // Nivel de acceso por tipo del equipo (backend: services/teamAccess.js).
    // Aquí solo decide qué botones se muestran: quien manda es el backend, que
    // lo vuelve a comprobar en cada petición.
    // -------------------------------------------------------------------------

    /** El equipo del usuario solo tiene acceso de consulta a ese tipo. */
    isReadOnlyType(type) {
      if (!this.user || (this.user.roleLevel || 0) >= 100) return false
      return (this.user.teamReadOnlyTypes || []).includes(type)
    },

    /** Puede modificar un recurso o credencial de ese tipo y equipo propietario. */
    canModifyOwned(type, ownerTeamId) {
      if (!this.isReadOnlyType(type)) return true
      return this.user.teamId != null && ownerTeamId != null && Number(ownerTeamId) === Number(this.user.teamId)
    },

    /** Descifrar esta credencial le pedirá un motivo (es de otro equipo). */
    needsDecryptReason(cred) {
      return this.isReadOnlyType(cred.resource_type) && !this.canModifyOwned(cred.resource_type, cred.owner_team_id)
    },
  },
})
