import { defineStore } from 'pinia'
import api from '../api/index.js'

// =============================================================================
// settingsStore.js — Configuración pública del sistema (Pinia).
//
// Carga los parámetros públicos (timezone, locale, app_name) desde el backend
// al arrancar la aplicación. Se usan como fuente de verdad para:
//   - Formateo de fechas y horas en toda la interfaz.
//   - Nombre de la aplicación en el header.
//   - Locale para separadores numéricos y de moneda.
//
// Si la llamada al backend falla, se usan los valores por defecto (Lima, es-PE).
// =============================================================================

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    timezone: 'America/Lima',
    locale: 'es-PE',
    appName: 'ICM — Gestión de Credenciales',
    decryptTimeoutSecs: 30,
    loaded: false,
    theme: localStorage.getItem('icm_theme') || 'light',
  }),

  actions: {
    toggleTheme() {
      const next = this.theme === 'light' ? 'dark' : 'light'
      localStorage.setItem('icm_theme', next)
      this.theme = next
    },

    /**
     * Cargar configuración pública desde el backend.
     * Solo se ejecuta una vez (guarda en loaded=true).
     */
    async loadPublic() {
      if (this.loaded) return
      try {
        const data = await api.get('/system/settings/public')
        const s = data?.settings || {}
        this.timezone = s.timezone?.value || 'America/Lima'
        this.locale = s.locale?.value || 'es-PE'
        this.appName = s.app_name?.value || 'ICM — Gestión de Credenciales'
        this.decryptTimeoutSecs = parseInt(s.decrypt_timeout_secs?.value || '30', 10)
        this.loaded = true
      } catch {
        // Error de red o backend no disponible — usar valores por defecto
        this.loaded = true
      }
    },

    /**
     * Formatear una fecha ISO al locale y timezone del sistema.
     */
    formatDate(isoString) {
      if (!isoString) return '—'
      try {
        return new Date(isoString).toLocaleString(this.locale, { timeZone: this.timezone })
      } catch {
        return new Date(isoString).toLocaleString()
      }
    },

    /**
     * Refrescar configuración (tras guardar cambios en SystemSettingsPage).
     */
    async refresh() {
      this.loaded = false
      await this.loadPublic()
    },
  },
})
