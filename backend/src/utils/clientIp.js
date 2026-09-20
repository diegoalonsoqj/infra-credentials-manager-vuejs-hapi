'use strict';

const logger = require('./logger');

// =============================================================================
// clientIp.js — Resolución de la IP real del cliente detrás de proxies inversos.
//
// hapi no tiene un equivalente a `app.set('trust proxy')` de Express, así que
// replicamos aquí exactamente la misma semántica (la de proxy-addr):
//
//   TRUST_PROXY=0 / 'false' / sin definir → IP directa del socket.
//   TRUST_PROXY=N (entero)                → se confía en los N saltos más
//                                           cercanos, por lo que la IP del
//                                           cliente es la entrada N-ésima
//                                           contando desde la DERECHA de
//                                           X-Forwarded-For.
//   TRUST_PROXY=true                      → se confía en toda la cadena: la IP
//                                           del cliente es la entrada más a la
//                                           izquierda de X-Forwarded-For.
//
// Si X-Forwarded-For tiene menos entradas que saltos configurados, se devuelve
// la entrada más a la izquierda (mismo comportamiento que proxy-addr, que corta
// el recorrido al agotar la lista).
//
// SEGURIDAD: X-Forwarded-For solo se consulta cuando TRUST_PROXY está activo.
// Sin proxy configurado el header es falsificable, y por eso se ignora: la IP
// alimenta el rate limiting y el log de auditoría.
// =============================================================================

const rawTrustProxy = process.env.TRUST_PROXY;

let trustedHops = 0;   // 0 = no confiar en ningún proxy
let trustAll    = false;

if (rawTrustProxy && rawTrustProxy !== '0' && rawTrustProxy !== 'false') {
  if (/^\d+$/.test(rawTrustProxy)) {
    trustedHops = parseInt(rawTrustProxy, 10);
  } else if (rawTrustProxy === 'true') {
    trustAll = true;
  } else {
    // Express admite además listas de IP/subredes ('loopback', '10.0.0.0/8'…).
    // Aquí no se soportan: avisamos y caemos al caso más seguro (sin proxy).
    logger.warn(
      'TRUST_PROXY con un valor no soportado. Usa un entero (0, 1, 2…) o "true". ' +
      'Se ignorará X-Forwarded-For.',
      { value: rawTrustProxy }
    );
  }
}

/**
 * Devuelve la IP del cliente para el request dado.
 *
 * @param {object} request - Request de hapi.
 * @returns {string} IP del cliente (equivalente a req.ip de Express).
 */
function clientIp(request) {
  const socketIp = request.info.remoteAddress;

  if (!trustAll && trustedHops === 0) return socketIp;

  const header = request.headers['x-forwarded-for'];
  if (!header) return socketIp;

  const forwarded = header
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

  if (forwarded.length === 0) return socketIp;

  if (trustAll) return forwarded[0];

  // N saltos de confianza → índice N-ésimo desde la derecha, acotado al inicio.
  const index = Math.max(0, forwarded.length - trustedHops);
  return forwarded[index] !== undefined ? forwarded[index] : forwarded[0];
}

module.exports = { clientIp };
