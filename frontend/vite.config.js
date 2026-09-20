import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// =============================================================================
// vite.config.js — Configuración de build y servidor de desarrollo.
//
// SEGURIDAD: sourcemap deshabilitado en producción para no exponer
// el código fuente minificado al cliente.
// =============================================================================

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = env.VITE_API_URL || 'http://localhost:8743'

  return {
    plugins: [vue()],

    resolve: {
      alias: {
        // Sin alias a vue.esm-bundler: no hay plantillas en string, así que no
        // hace falta el compilador en el navegador. Es intencionado — usarlo
        // obliga a new Function(), que la CSP del backend bloquea (script-src
        // 'self', sin unsafe-eval) y deja la página en blanco en producción.
        '@': path.resolve(__dirname, './src'),
      },
    },

    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },

    build: {
      // CRÍTICO: no exponer sourcemaps en producción
      sourcemap: false,
      // Vite 8 empaqueta con Rolldown: no admite manualChunks en forma de
      // objeto, así que los mismos dos chunks se declaran como grupos. vendor
      // lleva más prioridad porque coreui arrastra sus dependencias (Vue).
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              { name: 'vendor', priority: 20, test: /[\\/]node_modules[\\/](@vue[\\/]|vue[\\/]|vue-router[\\/]|pinia[\\/])/ },
              { name: 'coreui', priority: 10, test: /[\\/]node_modules[\\/]@coreui[\\/](vue|coreui)[\\/]/ },
            ],
          },
        },
      },
    },
  }
})
