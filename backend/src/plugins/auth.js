'use strict';

const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const { query }    = require('../config/database');
const logger       = require('../utils/logger');
const { clientIp } = require('../utils/clientIp');
const { isSetupCompleted, getSetupToken } = require('../setup/setupState');
const settings     = require('../config/settings');
const { AUDIT_ACTIONS, RESULT } = require('../config/constants');

// Caducidad por inactividad (ajuste session_idle_minutes; 0 = desactivada).
// La marca de actividad se refresca como mucho cada IDLE_TOUCH_SECONDS: no hace
// falta una escritura por petición para medir minutos.
const IDLE_DEFAULT_MINUTES = 30;
const IDLE_RANGE           = { min: 0, max: 1440 };
const IDLE_TOUCH_SECONDS   = 60;

// =============================================================================
// plugins/auth.js — Estrategias de autenticación.
//
//   'session' : JWT + sesión activa en BD. Sustituye al middleware verifyToken;
//               las rutas lo activan con `options.auth: 'session'`.
//   'setup'   : header x-setup-token del wizard + bloqueo post-instalación.
//               Sustituye a validateSetupToken + guardSetupNotCompleted.
//
// Ambos checks del wizard viven en una estrategia (y no en `options.pre`)
// porque hapi ejecuta la autenticación ANTES de validar el payload: así una
// llamada sin token válido sigue recibiendo 403 sin que se le devuelvan
// primero los detalles de validación del cuerpo, igual que en la cadena de
// middlewares anterior.
//
// FLUJO DE VERIFICACIÓN (idéntico al anterior):
//   1. Extraer el token de la cookie HttpOnly y, como respaldo, del header
//      Authorization: Bearer.
//   2. Verificar firma JWT con JWT_SECRET.
//   3. Calcular SHA-256 del token y buscar sesión activa en tbl_sessions
//      (no revocada, no expirada). Doble check: JWT + BD.
//   4. Publicar los datos del usuario en request.auth.credentials.
//
// La doble verificación (JWT + sesión en BD) permite revocar tokens
// inmediatamente desde el panel de administración sin esperar expiración.
//
// SEGURIDAD:
// - Nunca loguear el token en texto plano.
// - En cualquier falla → 401 genérico (no revelar motivo específico).
// =============================================================================

const COOKIE_NAME = 'icm_session';

const SESSION_QUERY = `
  SELECT
    s.id        AS session_id,
    EXTRACT(EPOCH FROM (NOW() - s.last_activity_at))::int AS idle_seconds,
    u.id,
    u.username,
    u.first_name,
    u.last_name,
    u.full_name,
    u.estado    AS user_estado,
    u.estado_registro AS user_estado_registro,
    u.locked_until,
    u.force_pwd_change,
    u.mfa_enabled,
    u.auth_source,
    r.code      AS role,
    r.id        AS role_id,
    r.level     AS role_level,
    t.code      AS team,
    u.team_id,
    COALESCE(
      ARRAY_AGG(DISTINCT trt.resource_type) FILTER (WHERE trt.resource_type IS NOT NULL),
      ARRAY[]::varchar[]
    ) AS team_resource_types,
    COALESCE(
      ARRAY_AGG(DISTINCT trt.resource_type) FILTER (WHERE trt.access_level = 'READ'),
      ARRAY[]::varchar[]
    ) AS team_read_only_types,
    COALESCE(
      ARRAY_AGG(DISTINCT p.code ORDER BY p.code) FILTER (WHERE p.code IS NOT NULL),
      ARRAY[]::varchar[]
    ) AS permissions
  FROM sch_system.tbl_sessions s
  JOIN sch_system.tbl_users    u   ON u.id  = s.user_id
  JOIN sch_system.tbl_roles    r   ON r.id  = u.role_id
  LEFT JOIN sch_system.tbl_teams                 t   ON t.id   = u.team_id
  LEFT JOIN sch_system.tbl_team_resource_types   trt ON trt.team_id = t.id
  LEFT JOIN sch_system.tbl_role_permissions      rp  ON rp.role_id  = r.id
  LEFT JOIN sch_system.tbl_permissions           p   ON p.id = rp.permission_id
  WHERE s.token_hash = $1
    AND s.revoked = FALSE
    AND s.expires_at > NOW()
  GROUP BY s.id, u.id, u.username, u.first_name, u.last_name, u.full_name,
           u.estado, u.estado_registro, u.locked_until, u.force_pwd_change, u.mfa_enabled,
           u.auth_source, u.team_id, r.code, r.id, r.level, t.code`;

/**
 * Comparacion de dos secretos en tiempo constante.
 *
 * Se rellena al tamano mayor para que timingSafeEqual se ejecute siempre: si se
 * le pasan buffers de distinta longitud lanza, y ese cortocircuito filtraria la
 * longitud del token real. La comprobacion de longitud se hace aparte y se
 * combina con AND, igual que en la rotacion de Master Key (security.routes.js).
 */
function secretosIguales(a, b) {
  const bufA = Buffer.from(String(a || ''));
  const bufB = Buffer.from(String(b || ''));
  const max  = Math.max(bufA.length, bufB.length, 1);
  const padA = Buffer.alloc(max);
  const padB = Buffer.alloc(max);
  bufA.copy(padA);
  bufB.copy(padB);
  return crypto.timingSafeEqual(padA, padB) && bufA.length === bufB.length;
}

/** Respuesta de rechazo: siempre 401, sin detalles del motivo real. */
function deny(h, code, message) {
  return h.response({ success: false, code, message }).code(401).takeover();
}

async function authenticate(request, h) {
  try {
    // 1. Extraer token: cookie HttpOnly primero, luego header Authorization como fallback
    const cookieToken = request.state?.[COOKIE_NAME];
    const authHeader  = request.headers.authorization;
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const token       = cookieToken || bearerToken;

    if (!token) {
      return deny(h, 'UNAUTHORIZED', 'Autenticación requerida.');
    }

    // 2. Verificar firma y expiración del JWT
    let decoded;
    try {
      // Fijar el algoritmo esperado (HS256) evita ataques de confusión de algoritmo:
      // sin esta lista, jsonwebtoken aceptaría cualquier algoritmo indicado en el header del token.
      decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    } catch (jwtErr) {
      // Loguear solo el tipo de error, nunca el token
      logger.warn('Token JWT inválido.', {
        errorType: jwtErr.name,
        ip: clientIp(request),
        url: request.url.pathname + (request.url.search || ''),
      });
      return deny(h, 'UNAUTHORIZED', 'Token inválido o expirado.');
    }

    // 3. Verificar sesión activa en BD
    // Calculamos SHA-256 del token para buscar en tbl_sessions (nunca el token raw en BD)
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const { rows }  = await query(SESSION_QUERY, [tokenHash]);

    if (rows.length === 0) {
      logger.warn('Sesión no encontrada o revocada.', { ip: clientIp(request), user: decoded?.sub });
      return deny(h, 'UNAUTHORIZED', 'Sesión inválida o expirada.');
    }

    const session = rows[0];

    // Verificar que el usuario esté activo
    if (session.user_estado !== 'AI' || session.user_estado_registro !== 'O') {
      logger.warn('Acceso denegado: usuario inactivo.', { username: session.username });
      return deny(h, 'UNAUTHORIZED', 'Usuario inactivo.');
    }

    // Verificar bloqueo temporal
    if (session.locked_until && new Date(session.locked_until) > new Date()) {
      logger.warn('Acceso denegado: usuario bloqueado temporalmente.', {
        username: session.username,
      });
      return deny(h, 'ACCOUNT_LOCKED', 'Cuenta bloqueada temporalmente.');
    }

    // Caducidad por inactividad. Se comprueba aquí, en el
    // servidor: cerrar la pestaña o dejar el equipo desatendido no deja la
    // sesión abierta hasta que venza su duración (session_ttl_minutes).
    const idleMinutes = await settings.getInt('session_idle_minutes', IDLE_DEFAULT_MINUTES, IDLE_RANGE);
    if (idleMinutes > 0 && session.idle_seconds > idleMinutes * 60) {
      await query(
        'UPDATE sch_system.tbl_sessions SET revoked = TRUE, revoked_at = NOW() WHERE id = $1 AND revoked = FALSE',
        [session.session_id]
      );
      await query(
        `INSERT INTO sch_audit.tbl_audit_log (user_id, username, action, resource_type, result, fail_reason, ip_address, extra_data)
         VALUES ($1, $2, $3, 'SYS', $4, $5, $6, $7)`,
        [session.id, session.username, AUDIT_ACTIONS.SESSION_IDLE_EXPIRED, RESULT.SUCCESS,
         `Sin actividad durante más de ${idleMinutes} minutos.`, clientIp(request),
         JSON.stringify({ idleSeconds: session.idle_seconds })]
      ).catch(() => {});
      return deny(h, 'SESSION_IDLE', 'La sesión se cerró por inactividad. Inicia sesión de nuevo.');
    }
    // Cada cuánto se refresca la marca. Como mucho IDLE_TOUCH_SECONDS, pero
    // nunca más tarde de la mitad del límite: con un límite pequeño (1 o 2
    // minutos) refrescar solo cada minuto dejaba caducar sesiones EN USO.
    const touchAfter = idleMinutes > 0
      ? Math.max(5, Math.min(IDLE_TOUCH_SECONDS, (idleMinutes * 60) / 2))
      : IDLE_TOUCH_SECONDS;
    if (session.idle_seconds >= touchAfter) {
      await query('UPDATE sch_system.tbl_sessions SET last_activity_at = NOW() WHERE id = $1', [session.session_id]);
    }

    // 4. Publicar los datos del usuario (antes: req.user)
    return h.authenticated({
      credentials: {
        id:                session.id,
        username:          session.username,
        firstName:         session.first_name || null,
        lastName:          session.last_name  || null,
        fullName:          session.full_name || null,
        role:              session.role,
        roleId:            session.role_id,
        level:             session.role_level,
        team:              session.team || null,
        teamId:            session.team_id ?? null,
        teamResourceTypes: session.team_resource_types || [],
        // Tipos con acceso de consulta (migración 022, services/teamAccess.js).
        teamReadOnlyTypes: session.team_read_only_types || [],
        permissions:       session.permissions || [],
        sessionId:         session.session_id,
        // Lo consume plugins/passwordChangeGuard.js: mientras esté a TRUE la
        // sesión solo puede cambiar la contraseña.
        forcePwdChange:    session.force_pwd_change === true,
        mfaEnabled:        session.mfa_enabled === true,
        authSource:        session.auth_source || 'LOCAL',
      },
    });
  } catch (err) {
    // Error inesperado (ej: BD caída)
    logger.error('Error en la autenticación:', { code: err.code });
    return deny(h, 'UNAUTHORIZED', 'Error de autenticación.');
  }
}

/**
 * Autenticación del wizard de instalación.
 *
 * 1. El header x-setup-token debe coincidir con el token del proceso. El token
 *    se imprime en la salida estándar al arrancar sin instalar, de modo que
 *    solo el operador con acceso a la consola puede completar el wizard.
 * 2. Una vez instalado el sistema, el wizard queda cerrado permanentemente.
 */
function authenticateSetupToken(request, h) {
  const token = request.headers['x-setup-token'];
  // Comparacion en tiempo constante: el resto del codigo que compara secretos
  // (verifyMasterKey, la confirmacion de clave en rotate-key) ya lo hacia, y
  // este era el unico que quedaba con un !== directo.
  if (!token || !secretosIguales(token, getSetupToken())) {
    return h.response({
      success: false,
      code: 'INVALID_SETUP_TOKEN',
      message: 'Setup token inválido. El token se imprime en la consola del servidor al arrancar sin instalar.',
    }).code(403).takeover();
  }

  if (isSetupCompleted()) {
    return h.response({
      success: false,
      code: 'SETUP_ALREADY_COMPLETED',
      message: 'El sistema ya está instalado.',
    }).code(403).takeover();
  }

  return h.authenticated({ credentials: { setup: true } });
}

const plugin = {
  name: 'icm-auth',
  register(server) {
    // Cookie de sesión. encoding 'none' → el JWT se guarda tal cual, sin firma
    // adicional de hapi (el propio JWT ya está firmado).
    server.state(COOKIE_NAME, {
      ttl:          null,
      isHttpOnly:   true,
      // SEGURIDAD: el flag Secure se ata al TLS real (HTTPS_ENABLED), no al
      // entorno. Un despliegue con NODE_ENV=production servido por HTTP plano
      // marcaría la cookie como Secure y el navegador no la reenviaría nunca:
      // login correcto, siguiente petición 401. Solo localhost se salva, por
      // ser contexto seguro. Con nginx terminando TLS: HTTPS_ENABLED=true.
      isSecure:     process.env.HTTPS_ENABLED === 'true',
      isSameSite:   'Strict',
      path:         '/',
      encoding:     'none',
      clearInvalid: false,
      ignoreErrors: true,
    });

    server.auth.scheme('icm-session', () => ({ authenticate }));
    server.auth.strategy('session', 'icm-session');

    server.auth.scheme('icm-setup-token', () => ({ authenticate: authenticateSetupToken }));
    server.auth.strategy('setup', 'icm-setup-token');
    // Sin estrategia por defecto: cada ruta declara `auth: 'session'`
    // explícitamente, igual que antes se encadenaba requireAuth.
  },
};

module.exports = plugin;
module.exports.COOKIE_NAME = COOKIE_NAME;
