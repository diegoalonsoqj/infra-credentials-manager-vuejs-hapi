'use strict';

// =============================================================================
// rateLimits.js — Configuración central de los limitadores de peticiones.
//
// BY_PATH_PREFIX se aplica por prefijo de ruta y por IP, antes del enrutamiento
// (equivalente a los `app.use('/api/', limiter)` de Express); BY_USER, por
// usuario tras autenticar; el de descifrado y los de contraseña, dentro de su
// ruta.
//
// Los límites del wizard se aplican por prefijo, y no dentro de la ruta, para
// que se contabilicen antes de cualquier otra comprobación: así una avalancha
// de peticiones nunca llega a abrir conexiones a BD ni a ejecutar bcrypt.
// =============================================================================

const GLOBAL_MESSAGE = {
  success: false,
  code: 'RATE_LIMIT_EXCEEDED',
  message: 'Demasiadas solicitudes. Intenta nuevamente más tarde.',
};

// El límite general se aplica en dos capas.
//
// Antes era uno solo, por IP y antes de autenticar, con 100 peticiones por
// ventana en el .env. Cada pantalla hace de 3 a 6 llamadas a la API, así que un
// solo usuario lo agotaba en unos minutos de trabajo normal; y detrás de un NAT
// o una VPN corporativa todos comparten IP de salida, de modo que el primero en
// agotarlo dejaba sin API a los demás.
//
// GLOBAL_IP: tope por IP, antes de autenticar. Solo frena avalanchas (también
// las de peticiones sin sesión), por eso es alto: tiene que caberle una oficina
// entera detrás de la misma IP.
const GLOBAL_IP = {
  prefix:   '/api',
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 min
  max:      parseInt(process.env.RATE_LIMIT_IP_MAX || '5000', 10),
  message:  GLOBAL_MESSAGE,
};

// GLOBAL_USER: cuota por usuario autenticado, después de autenticar (clave
// userKey, como el descifrado). Es el límite que acota a cada cuenta, y no se
// reparte entre quienes salen por la misma IP.
const GLOBAL_USER = {
  prefix:   '/api',
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
  max:      parseInt(process.env.RATE_LIMIT_MAX || '1000', 10),
  message:  GLOBAL_MESSAGE,
};

// Login, también en dos capas.
//
// Antes era un solo límite de 10 intentos por IP: detrás de un NAT, diez fallos
// de cualquiera dejaban a toda la oficina sin poder iniciar sesión durante 15
// minutos.
const AUTH_MESSAGE = {
  success: false,
  code: 'RATE_LIMIT_AUTH_EXCEEDED',
  message: 'Demasiados intentos de login. Intenta nuevamente más tarde.',
};

// AUTH_IP: tope por IP, antes de todo. Frena a quien reparte intentos entre
// muchas cuentas desde una IP y acota el gasto de bcrypt (f14, ~2 s por
// intento), pero deja sitio a los logins de una oficina entera. Solo
// /api/auth/login: antes cubría todo /api/auth y cada logout gastaba un intento.
const AUTH_IP = {
  prefix:   '/api/auth/login',
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
  max:      parseInt(process.env.RATE_LIMIT_AUTH_IP_MAX || '200', 10),
  message:  AUTH_MESSAGE,
};

// El segundo paso del login (código TOTP) tiene el mismo tope por IP.
const AUTH_MFA_IP = { ...AUTH_IP, prefix: '/api/auth/mfa' };

// AUTH: intentos por usuario e IP (clave loginKey), en la ruta de login, antes
// de bcrypt. Los fallos de una persona ya no bloquean a las demás. Contar solo
// por usuario dejaría a cualquiera bloquear el login ajeno desde fuera; eso ya
// lo acota el bloqueo de cuenta (account_lockout_attempts, 5 por defecto).
const AUTH = {
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
  max:      parseInt(process.env.RATE_LIMIT_AUTH_MAX || '10', 10),
  message:  AUTH_MESSAGE,
};

// Máx 20 intentos por IP por hora. Un operador legítimo puede necesitar varios
// intentos durante el setup; 20 previene enumeración masiva de infraestructura interna.
const SETUP_TEST_DB = {
  prefix:   '/api/setup/test-db',
  windowMs: 60 * 60 * 1000,
  max:      20,
  message: {
    success: false,
    code: 'SETUP_RATE_LIMIT',
    message: 'Demasiados intentos de conexión. Intenta nuevamente en 1 hora.',
  },
};

// Máx 5 intentos por IP por hora. Previene abuso de bcrypt f14 + migraciones en bucle.
const SETUP_FINALIZE = {
  prefix:   '/api/setup/finalize',
  windowMs: 60 * 60 * 1000,
  max:      5,
  message: {
    success: false,
    code: 'SETUP_RATE_LIMIT',
    message: 'Demasiados intentos de instalación. Intenta nuevamente en 1 hora.',
  },
};

// Rutas que ejecutan bcrypt con factor 14 (~2^14 iteraciones). En este
// despliegue una sola llamada tarda unos 3,8 s (medido en los logs sobre
// /api/profile/change-password), y bcryptjs es JavaScript puro: ese trabajo
// compite por el mismo hilo que atiende al resto de peticiones.
//
// Sin un límite propio solo las cubría el global de /api —500 por ventana de 15
// min—, así que una única sesión válida podía encolar del orden de media hora de
// CPU y dejar la API inservible para todos. El login ya estaba a salvo por el
// límite de /api/auth; estas tres rutas eran las que faltaban.
//
// Se cuenta POR USUARIO (keyOf: userKey), como el descifrado: a ellas no se
// llega sin sesión, y contar por IP repartiría la cuota entre todos los que
// salgan por el mismo NAT corporativo.

// Cambio de contraseña propio: dos operaciones bcrypt (compare + hash). Cinco
// por ventana sobran para cualquier uso legítimo.
const PASSWORD_CHANGE = {
  windowMs: 15 * 60 * 1000,
  max:      5,
  message: {
    success: false,
    code:    'PASSWORD_RATE_LIMIT',
    message: 'Demasiados intentos de cambio de contraseña. Intenta nuevamente más tarde.',
  },
};

// Alta de usuario y reseteo de contraseña por un ADMIN. Más holgado: dar de alta
// a un equipo entero en una sesión de trabajo es legítimo. Aun así acota el
// gasto a unos dos minutos de CPU por ventana y administrador.
const PASSWORD_ADMIN = {
  windowMs: 15 * 60 * 1000,
  max:      30,
  message: {
    success: false,
    code:    'PASSWORD_RATE_LIMIT',
    message: 'Demasiadas operaciones de contraseña seguidas. Intenta nuevamente más tarde.',
  },
};

// Segundo factor: activar, desactivar y regenerar códigos. Cuenta por usuario.
// Más holgado que el cambio de contraseña porque el usuario suele equivocarse
// al teclear el primer código o al escanear, pero acota el ensayo de códigos.
const MFA_MANAGE = {
  windowMs: 15 * 60 * 1000,
  max:      parseInt(process.env.RATE_LIMIT_MFA_MAX || '15', 10),
  message: {
    success: false,
    code:    'MFA_RATE_LIMIT',
    message: 'Demasiados intentos con el segundo factor. Intenta nuevamente más tarde.',
  },
};

// Descifrado: operación CPU-intensiva con pgcrypto.
const DECRYPT = {
  windowMs: 60 * 1000, // 1 minuto
  max:      10,
  message: {
    success: false,
    code:    'DECRYPT_RATE_LIMIT',
    message: 'Demasiadas solicitudes de descifrado. Intenta nuevamente en un minuto.',
  },
};

// Orden de aplicación: del más general al más específico, para que el
// limitador más restrictivo escriba las últimas cabeceras RateLimit-*.
const BY_PATH_PREFIX = [GLOBAL_IP, AUTH_IP, AUTH_MFA_IP, SETUP_TEST_DB, SETUP_FINALIZE];

// Limitadores por usuario, aplicados tras autenticar (onPostAuth).
const BY_USER = [GLOBAL_USER];

// Descripción de los límites en vigor, para mostrarlos en Configuración en solo
// lectura (GET /api/system/rate-limits). Se construye a partir de los mismos
// objetos que usan los limitadores, así que enseña los valores que rigen de
// verdad, no una copia. `source` es la variable de entorno que lo fija, o null
// si es una constante del código.
//
// No son editables desde el panel a propósito: son protecciones de
// infraestructura que dependen de la red (NAT, proxy) y, fuera del panel, una
// sesión de administrador robada no puede relajarlas.
const DESCRIPTIONS = [
  { limit: AUTH,            label: 'Intentos de login por usuario e IP', scope: 'usuario e IP', source: 'RATE_LIMIT_AUTH_MAX' },
  { limit: AUTH_IP,         label: 'Intentos de login por IP',           scope: 'IP',           source: 'RATE_LIMIT_AUTH_IP_MAX' },
  { limit: AUTH,            label: 'Códigos de segundo factor por usuario e IP', scope: 'usuario e IP', source: 'RATE_LIMIT_AUTH_MAX' },
  { limit: AUTH_MFA_IP,     label: 'Códigos de segundo factor por IP',   scope: 'IP',           source: 'RATE_LIMIT_AUTH_IP_MAX' },
  { limit: GLOBAL_USER,     label: 'Peticiones a la API por usuario',    scope: 'usuario',      source: 'RATE_LIMIT_MAX' },
  { limit: GLOBAL_IP,       label: 'Peticiones a la API por IP',         scope: 'IP',           source: 'RATE_LIMIT_IP_MAX' },
  { limit: DECRYPT,         label: 'Descifrados de contraseña',          scope: 'usuario',      source: null },
  { limit: PASSWORD_CHANGE, label: 'Cambios de la propia contraseña',    scope: 'usuario',      source: null },
  { limit: MFA_MANAGE,      label: 'Gestión del segundo factor',        scope: 'usuario',      source: 'RATE_LIMIT_MFA_MAX' },
  { limit: PASSWORD_ADMIN,  label: 'Altas y reseteos de contraseña de usuarios', scope: 'administrador', source: null },
  { limit: SETUP_TEST_DB,   label: 'Pruebas de conexión del asistente de instalación', scope: 'IP', source: null },
  { limit: SETUP_FINALIZE,  label: 'Intentos de finalizar la instalación', scope: 'IP',         source: null },
];

function describeLimits() {
  return DESCRIPTIONS.map(({ limit, label, scope, source }) => ({
    label,
    max:           limit.max,
    windowMinutes: Math.round(limit.windowMs / 60000),
    scope,
    source,
  }));
}

module.exports = {
  describeLimits,
  GLOBAL_IP, GLOBAL_USER, BY_USER, AUTH_IP, AUTH_MFA_IP, AUTH, SETUP_TEST_DB, SETUP_FINALIZE, DECRYPT,
  PASSWORD_CHANGE, PASSWORD_ADMIN, MFA_MANAGE,
  BY_PATH_PREFIX,
};
