'use strict';

const { clientIp } = require('../utils/clientIp');

// =============================================================================
// plugins/rateLimit.js — Rate limiting por IP y por usuario (reemplazo de express-rate-limit).
//
// Replica el algoritmo del store por defecto de express-rate-limit: ventana
// fija en memoria por clave (IP), contador que se reinicia al vencer la
// ventana, y cabeceras estándar RateLimit-Limit / RateLimit-Remaining /
// RateLimit-Reset (draft-6) más Retry-After al bloquear.
//
// Tres formas de uso:
//   1. Limitadores por prefijo de ruta (`byPathPrefix`), aplicados en onRequest
//      —antes del enrutamiento y de la autenticación, igual que los
//      `app.use('/api/', limiter)` de Express. Cuentan por IP.
//   2. Limitadores por prefijo y por usuario (`byUser`), aplicados en
//      onPostAuth a las peticiones con sesión.
//   3. `rateLimitPre(options)`, un pre-handler para rutas concretas, que se
//      coloca en `options.pre` en la misma posición que ocupaba el middleware.
//
// Al ser un store en memoria, el conteo es por proceso (idéntico a antes: el
// MemoryStore de express-rate-limit tampoco se comparte entre instancias).
// =============================================================================

const REQUEST_STATE = 'icm-rate-limit';

/**
 * Crea un limitador de ventana fija con su propio almacén en memoria.
 *
 * @param {object}  opts
 * @param {number}  opts.windowMs - Duración de la ventana en milisegundos.
 * @param {number}  opts.max      - Peticiones permitidas por ventana y clave.
 * @param {object}  opts.message  - Cuerpo JSON devuelto al superar el límite.
 * @returns {{ consume: function, message: object }}
 */
function createLimiter({ windowMs, max, message }) {
  /** @type {Map<string, {count: number, resetAt: number}>} */
  const hits = new Map();

  // Barrido periódico de claves vencidas: evita crecimiento sin límite del Map.
  // unref() para que el timer no mantenga vivo el proceso (tests, SIGTERM).
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, windowMs);
  if (typeof sweeper.unref === 'function') sweeper.unref();

  /**
   * Registra una petición de `key` y devuelve el estado del límite.
   */
  function consume(key) {
    const now = Date.now();
    let entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }

    entry.count += 1;

    const resetSeconds = Math.max(0, Math.ceil((entry.resetAt - now) / 1000));

    return {
      limited:   entry.count > max,
      headers: {
        'RateLimit-Limit':     String(max),
        'RateLimit-Remaining': String(Math.max(0, max - entry.count)),
        'RateLimit-Reset':     String(resetSeconds),
      },
      resetSeconds,
    };
  }

  return { consume, message, reset: () => hits.clear() };
}

/**
 * Acumula las cabeceras del limitador en el request para escribirlas en la
 * respuesta. Si varios limitadores afectan al mismo request, gana el último
 * (mismo comportamiento que middlewares encadenados de express-rate-limit).
 */
function recordHeaders(request, headers) {
  request.plugins[REQUEST_STATE] = {
    ...(request.plugins[REQUEST_STATE] || {}),
    ...headers,
  };
}

function buildLimitedResponse(h, limiter, result) {
  const response = h.response(limiter.message).code(429);
  for (const [name, value] of Object.entries(result.headers)) {
    response.header(name, value);
  }
  response.header('Retry-After', String(result.resetSeconds));
  return response;
}

/**
 * Clave por defecto: la IP del cliente. Es la única disponible en los
 * limitadores por prefijo, que corren en onRequest (antes de autenticar).
 */
function ipKey(request) {
  return clientIp(request);
}

/**
 * Clave por usuario autenticado, con reserva a la IP.
 *
 * Para endpoints que solo alcanza una sesión válida, contar por IP es la clave
 * equivocada en los dos sentidos. En un despliegue corporativo detrás de un NAT
 * o una VPN todos los usuarios comparten IP de salida, así que el primero que
 * trabaje agota la cuota de los demás; y al mismo tiempo el límite no acota nada
 * por cuenta, porque quien tenga una sesión robada y varias IP de salida
 * multiplica su cuota. El identificador estable de quien consume el recurso es
 * el usuario.
 *
 * La reserva a la IP no debería darse nunca en una ruta autenticada, pero deja
 * el limitador cerrado si alguna vez se coloca en una que no lo esté.
 */
function userKey(request) {
  const id = request.auth?.credentials?.id;
  return id ? `user:${id}` : `ip:${clientIp(request)}`;
}

/**
 * Clave del login: IP más usuario (en minúsculas y sin espacios, como lo
 * compara el login). Así los fallos de una persona no gastan los intentos de
 * quienes comparten su IP. Sin usuario en el cuerpo, solo la IP.
 */
function loginKey(request) {
  const username = request.payload?.username;
  const user = typeof username === 'string' ? username.trim().toLowerCase() : '';
  return `login:${clientIp(request)}:${user}`;
}

/**
 * Clave del segundo paso del login: IP más el usuario del token MFA. El token
 * se decodifica SIN verificar solo para contar; lo verifica el servicio. Un
 * token manipulado solo cambia a qué cubo cuenta, y el tope por IP
 * (AUTH_MFA_IP) sigue acotando.
 */
function mfaKey(request) {
  let sub = '';
  try {
    const payload = String(request.payload?.mfaToken || '').split('.')[1];
    sub = String(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).sub || '');
  } catch { /* token ilegible: solo la IP */ }
  return `mfa:${clientIp(request)}:${sub.slice(0, 64)}`;
}

/**
 * Pre-handler de rate limiting para una ruta concreta.
 * Se usa dentro de `options.pre` para conservar el orden exacto que tenía el
 * middleware equivalente en la cadena de Express.
 *
 * @param {object} opts - Igual que createLimiter.
 * @param {function} [opts.keyOf] - Extrae la clave de conteo del request.
 *        Por defecto la IP del cliente.
 * @returns {{ method: function, assign: string }} Entrada para options.pre.
 */
function rateLimitPre(opts) {
  const limiter = createLimiter(opts);
  const keyOf   = opts.keyOf || ipKey;

  return {
    assign: 'rateLimit',
    method: (request, h) => {
      const result = limiter.consume(keyOf(request));
      recordHeaders(request, result.headers);

      if (result.limited) {
        return buildLimitedResponse(h, limiter, result).takeover();
      }

      return result.headers;
    },
  };
}

/**
 * Plugin: limitadores globales por prefijo de ruta.
 *
 * @param {object} server
 * @param {object} options
 * @param {Array<{prefix: string, windowMs: number, max: number, message: object}>}
 *        options.byPathPrefix - Limitadores por IP, en orden de aplicación.
 * @param {Array<{prefix: string, windowMs: number, max: number, message: object}>}
 *        [options.byUser] - Limitadores por usuario autenticado.
 */
const plugin = {
  name: 'icm-rate-limit',
  register(server, options) {
    const limiters = (options.byPathPrefix || []).map((cfg) => ({
      prefix:  cfg.prefix,
      limiter: createLimiter(cfg),
    }));

    server.ext('onRequest', (request, h) => {
      const path = request.path;

      for (const { prefix, limiter } of limiters) {
        // Equivalente a app.use('/api/', …): coincide con el prefijo exacto
        // y con cualquier subruta.
        const matches = path === prefix || path.startsWith(`${prefix}/`);
        if (!matches) continue;

        const result = limiter.consume(clientIp(request));
        recordHeaders(request, result.headers);

        if (result.limited) {
          return buildLimitedResponse(h, limiter, result).takeover();
        }
      }

      return h.continue;
    });

    // Limitadores por usuario: tras autenticar, cuando ya hay credenciales.
    // Las peticiones sin sesión (login, health, estado del wizard) solo pasan
    // por los limitadores por IP de arriba.
    const userLimiters = (options.byUser || []).map((cfg) => ({
      prefix:  cfg.prefix,
      limiter: createLimiter(cfg),
    }));
    if (userLimiters.length > 0) {
      server.ext('onPostAuth', (request, h) => {
        if (!request.auth?.credentials?.id) return h.continue;
        const path = request.path;
        for (const { prefix, limiter } of userLimiters) {
          const matches = path === prefix || path.startsWith(`${prefix}/`);
          if (!matches) continue;
          const result = limiter.consume(userKey(request));
          recordHeaders(request, result.headers);
          if (result.limited) {
            return buildLimitedResponse(h, limiter, result).takeover();
          }
        }
        return h.continue;
      });
    }

    // Las cabeceras se escriben al final para que también aparezcan en las
    // respuestas correctas, no solo en los 429.
    server.ext('onPreResponse', (request, h) => {
      const headers = request.plugins[REQUEST_STATE];
      if (!headers) return h.continue;

      const response = request.response;
      for (const [name, value] of Object.entries(headers)) {
        if (response.isBoom) response.output.headers[name] = value;
        else response.header(name, value);
      }

      return h.continue;
    });
  },
};

module.exports = plugin;
module.exports.rateLimitPre = rateLimitPre;
module.exports.loginKey = loginKey;
module.exports.mfaKey = mfaKey;
module.exports.createLimiter = createLimiter;
module.exports.ipKey = ipKey;
module.exports.userKey = userKey;
