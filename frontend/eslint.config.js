// =============================================================================
// eslint.config.js — Configuración "flat" de ESLint 9 para el frontend.
//
// Sin este archivo `npm run lint` fallaba con "couldn't find a configuration
// file": ESLint 9 solo lee eslint.config.*. Las reglas comunes son las mismas
// que las del backend; eslint-plugin-vue añade el análisis de los .vue
// (plantilla y <script>), que son casi todo el código de src/.
// =============================================================================

import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'

const REGLAS_COMUNES = {
  'no-console':      'warn',
  // ignoreRestSiblings: `const { a, ...resto } = obj` es la forma de quitar una clave.
  'no-unused-vars':  ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', ignoreRestSiblings: true }],
  'no-var':          'error',
  'prefer-const':    'error',
  // `== null` / `!= null` se permiten: comprueban null y undefined a la vez.
  eqeqeq:            ['error', 'always', { null: 'ignore' }],

  // Seguridad: evitar eval y similares. Además la CSP del backend
  // (script-src 'self', sin unsafe-eval) dejaría la página en blanco.
  'no-eval':         'error',
  'no-implied-eval': 'error',
  'no-new-func':     'error',
}

export default [
  {
    ignores: ['dist/**', 'node_modules/**'],
  },

  js.configs.recommended,
  ...pluginVue.configs['flat/essential'],

  {
    files: ['src/**/*.{js,vue}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: {
      ...REGLAS_COMUNES,
      // Seguridad: v-html inyecta HTML sin escapar (XSS). En un gestor de
      // credenciales no se permite; si alguna vez hace falta, que sea explícito.
      'vue/no-v-html': 'error',
    },
  },

  {
    // Las páginas solo se cargan desde el router, nunca como etiqueta en una
    // plantilla, así que no pueden chocar con un elemento HTML (Login, Dashboard).
    files: ['src/pages/**/*.vue'],
    rules: { 'vue/multi-word-component-names': 'off' },
  },

  {
    // Configuración de build: corre en Node.
    files: ['vite.config.js', 'eslint.config.js'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
]
