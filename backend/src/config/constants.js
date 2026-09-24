'use strict';

// =============================================================================
// constants.js — Constantes del dominio (inmutables con Object.freeze)
// Fuente de verdad para roles, equipos, tipos de recurso, estados y auditoría.
// Importar desde aquí en lugar de usar strings mágicos en el código.
// =============================================================================

const ROLES = Object.freeze({
  ADMIN:    'ADMIN',
  LEADER:   'LEADER',
  SUPERVISOR: 'SUPERVISOR',
  OPERATOR: 'OPERATOR',
  VIEWER:   'VIEWER',
  VISITOR:  'VISITOR',
});

const TEAMS = Object.freeze({
  DBA:     'DBA',
  SYSADMIN: 'SYSADMIN',
  APPOPS:  'APPOPS',
  NETOPS:  'NETOPS',
});

const RESOURCE_TYPES = Object.freeze({
  DB:  'DB',
  OS:  'OS',
  APP: 'APP',
  NET: 'NET',
});

// Permisos del sistema. Usar estas constantes en requirePermission() y en el frontend.
const PERMISSIONS = Object.freeze({
  // Herramientas
  MOD_PWDGEN:   'MOD_PWDGEN',
  // Credenciales (filtradas por ámbito de equipo: DB/OS/APP/NET)
  CRED_VIEW:    'CRED_VIEW',
  CRED_EDIT:    'CRED_EDIT',
  CRED_DELETE:  'CRED_DELETE',
  CRED_REVEAL:  'CRED_REVEAL',
  // Recursos (instancias BD / servidores / apps)
  RES_VIEW:     'RES_VIEW',
  RES_EDIT:     'RES_EDIT',
  RES_DELETE:   'RES_DELETE',
  // Módulos de administración
  MOD_USERS:    'MOD_USERS',
  MOD_AUDIT:    'MOD_AUDIT',
  // Auditoría acotada a los tipos de recurso del equipo (migración 020).
  AUDIT_TEAM:   'AUDIT_TEAM',
  MOD_CATALOGS: 'MOD_CATALOGS',
  MOD_SECURITY: 'MOD_SECURITY',
  MOD_SYSTEM:   'MOD_SYSTEM',
});

const ENVIRONMENTS = Object.freeze({
  DEV: 'DEV',
  UAT: 'UAT',
  PRD: 'PRD',
});

// Jerarquía numérica: permite comparaciones >= en middleware de RBAC.
// Ej: si el endpoint requiere nivel >= 50, tanto OPERATOR como ADMIN pueden acceder.
const ROLE_LEVELS = Object.freeze({
  ADMIN:    100,
  LEADER:   70,
  SUPERVISOR: 60,
  OPERATOR: 50,
  VIEWER:   20,
  VISITOR:  0,
});

// Estado de registro: soft-delete.
// O = válido (activo lógicamente), X = eliminado lógicamente.
// Estado operativo: AI = activo, IN = inactivo.
const ESTADOS = Object.freeze({
  ACTIVO:   'AI',
  INACTIVO: 'IN',
  VALIDO:   'O',
  ELIMINADO: 'X',
});

// Resultado de auditoría
const RESULT = Object.freeze({
  SUCCESS: 'S',
  FAIL:    'F',
});

// =============================================================================
// AUDIT_ACTIONS — Acciones auditables del sistema.
// Usar SIEMPRE estas constantes en lugar de strings literales.
// Deben coincidir exactamente con los valores que se insertan en tbl_audit_log.
// =============================================================================
const AUDIT_ACTIONS = Object.freeze({
  // Sistema
  SETUP_COMPLETED: 'SETUP_COMPLETED',

  // Autenticación
  LOGIN_SUCCESS:   'LOGIN_SUCCESS',
  LOGIN_FAIL:      'LOGIN_FAIL',
  // Evento propio: sin el, un bloqueo solo se deducia contando filas LOGIN_FAIL
  // y no se podia filtrar ni alertar sobre el.
  ACCOUNT_LOCKED:  'ACCOUNT_LOCKED',
  // Contrapartida de ACCOUNT_LOCKED. El desbloqueo manual de una cuenta es una
  // intervencion de un ADMIN sobre la cuenta de otro y no dejaba ningun rastro:
  // era la unica accion del modulo de usuarios sin registro de auditoria.
  ACCOUNT_UNLOCKED: 'ACCOUNT_UNLOCKED',
  LOGOUT:          'LOGOUT',
  SESSION_REVOKED: 'SESSION_REVOKED',
  // Sesión cerrada por el servidor tras session_idle_minutes sin actividad.
  SESSION_IDLE_EXPIRED: 'SESSION_IDLE_EXPIRED',
  // Segundo factor (TOTP). MFA_FAIL es un código incorrecto en el login; los
  // fallos también cuentan para el bloqueo de cuenta.
  MFA_ENABLED:          'MFA_ENABLED',
  MFA_DISABLED:         'MFA_DISABLED',
  MFA_RESET:            'MFA_RESET',
  MFA_FAIL:             'MFA_FAIL',
  MFA_RECOVERY_USED:    'MFA_RECOVERY_USED',
  MFA_RECOVERY_CODES_REGENERATED: 'MFA_RECOVERY_CODES_REGENERATED',

  // Credenciales
  CREDENTIAL_VIEW:   'CREDENTIAL_VIEW',
  CREDENTIAL_DECRYPT: 'CREDENTIAL_DECRYPT',
  CREDENTIAL_CREATE: 'CREDENTIAL_CREATE',
  CREDENTIAL_UPDATE: 'CREDENTIAL_UPDATE',
  CREDENTIAL_DELETE: 'CREDENTIAL_DELETE',

  // Custodia exclusiva
  CUSTODIAN_ASSIGN:         'CUSTODIAN_ASSIGN',
  CUSTODIAN_REASSIGN:       'CUSTODIAN_REASSIGN',
  CUSTODIED_ACCESS_DENIED:  'CUSTODIED_ACCESS_DENIED',
  CUSTODIED_ACCESS_GRANTED: 'CUSTODIED_ACCESS_GRANTED',

  // Rotación de Master Key
  MASTER_KEY_ROTATION_START:   'MASTER_KEY_ROTATION_START',
  MASTER_KEY_ROTATION_SUCCESS: 'MASTER_KEY_ROTATION_SUCCESS',
  MASTER_KEY_ROTATION_FAIL:    'MASTER_KEY_ROTATION_FAIL',

  // Usuarios
  USER_CREATE:     'USER_CREATE',
  USER_UPDATE:     'USER_UPDATE',
  USER_DEACTIVATE: 'USER_DEACTIVATE',

  // Catálogos
  CATALOG_UPDATE: 'CATALOG_UPDATE',

  // Configuración del sistema
  SETTING_UPDATE: 'SETTING_UPDATE',
  // Prueba de conexión LDAP desde Configuración: es un bind real contra AD.
  LDAP_TEST:      'LDAP_TEST',
  // Cambio de la conexión LDAP (exige contraseña y segundo factor). Se registra
  // también el intento fallido: repetirlo es señal de una sesión robada.
  LDAP_CONFIG_UPDATE: 'LDAP_CONFIG_UPDATE',

  // Recursos — Bases de datos
  RESOURCE_DB_CREATE:          'RESOURCE_DB_CREATE',
  RESOURCE_DB_UPDATE:          'RESOURCE_DB_UPDATE',
  RESOURCE_DB_DELETE:          'RESOURCE_DB_DELETE',
  RESOURCE_DB_INSTANCE_CREATE: 'RESOURCE_DB_INSTANCE_CREATE',
  RESOURCE_DB_INSTANCE_UPDATE: 'RESOURCE_DB_INSTANCE_UPDATE',
  RESOURCE_DB_INSTANCE_DELETE: 'RESOURCE_DB_INSTANCE_DELETE',

  // Recursos — Servidores
  RESOURCE_OS_CREATE:          'RESOURCE_OS_CREATE',
  RESOURCE_OS_UPDATE:          'RESOURCE_OS_UPDATE',
  RESOURCE_OS_DELETE:          'RESOURCE_OS_DELETE',
  RESOURCE_OS_INSTANCE_CREATE: 'RESOURCE_OS_INSTANCE_CREATE',
  RESOURCE_OS_INSTANCE_UPDATE: 'RESOURCE_OS_INSTANCE_UPDATE',
  RESOURCE_OS_INSTANCE_DELETE: 'RESOURCE_OS_INSTANCE_DELETE',

  // Recursos — Aplicaciones
  RESOURCE_APP_CREATE: 'RESOURCE_APP_CREATE',
  RESOURCE_APP_UPDATE: 'RESOURCE_APP_UPDATE',
  RESOURCE_APP_DELETE: 'RESOURCE_APP_DELETE',

  // Recursos — Dispositivos de red
  RESOURCE_NET_CREATE: 'RESOURCE_NET_CREATE',
  RESOURCE_NET_UPDATE: 'RESOURCE_NET_UPDATE',
  RESOURCE_NET_DELETE: 'RESOURCE_NET_DELETE',
});

module.exports = {
  ROLES,
  TEAMS,
  RESOURCE_TYPES,
  ENVIRONMENTS,
  ROLE_LEVELS,
  PERMISSIONS,
  ESTADOS,
  RESULT,
  AUDIT_ACTIONS,
};
