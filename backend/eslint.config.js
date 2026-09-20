'use strict';

// =============================================================================
// eslint.config.js — Configuración "flat" de ESLint 9.
//
// Sustituye a .eslintrc.cjs, que ESLint 9 ya no lee: desde la versión 9 solo
// busca eslint.config.*, así que `npm run lint` fallaba con "couldn't find a
// configuration file" y el proyecto llevaba tiempo sin analizarse. Se conservan
// exactamente las mismas reglas que declaraba el archivo anterior.
//
// Cobertura: src/ (aplicación), scripts/ (utilidades de operación) y tests/.
// Cada zona tiene los globals que le corresponden.
// =============================================================================

const js = require('@eslint/js');
const globals = require('globals');

const REGLAS_COMUNES = {
  'no-console':      'warn',
  'no-unused-vars':  ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
  'no-var':          'error',
  'prefer-const':    'error',
  // `== null` / `!= null` se permiten: son la forma idiomatica de comprobar
  // "ni null ni undefined" a la vez, y reescribirlas con === perderia ese matiz.
  eqeqeq:            ['error', 'always', { null: 'ignore' }],

  // Seguridad: evitar eval y similares.
  'no-eval':         'error',
  'no-implied-eval': 'error',
  'no-new-func':     'error',
};

module.exports = [
  {
    ignores: ['node_modules/**', 'logs/**', 'coverage/**'],
  },

  js.configs.recommended,

  {
    // Código de la aplicación: CommonJS sobre Node.
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: REGLAS_COMUNES,
  },

  {
    // Scripts de operación: imprimen por consola a propósito, es su interfaz.
    files: ['scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: { ...REGLAS_COMUNES, 'no-console': 'off' },
  },

  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.jest },
    },
    rules: { ...REGLAS_COMUNES, 'no-console': 'off' },
  },
];
