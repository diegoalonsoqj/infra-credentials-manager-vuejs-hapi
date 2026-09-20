'use strict';

// =============================================================================
// sqlLike.js — Construccion del parametro de una clausula LIKE.
//
// POR QUE EXISTE:
//   Los cinco listados con buscador repetian `%${search.toLowerCase()}%`, y eso
//   traia dos problemas.
//
//   1. Los comodines del usuario se tomaban como comodines. Un '%' recorria la
//      tabla entera y un '_' casaba con cualquier caracter: el buscador no
//      buscaba lo que se escribia en el. Aqui se escapan, de modo que LIKE
//      trata el texto como texto. Los comodines los pone esta funcion.
//
//   2. Un `search` que no fuese una cadena reventaba con TypeError antes de
//      llegar a la consulta. hapi convierte los parametros repetidos de la
//      query string en un array, asi que `?search=a&search=b` bastaba para
//      provocar un 500 — un fallo del servidor causado por una peticion del
//      cliente. Las rutas ya lo rechazan con un esquema Joi; esto lo cierra
//      tambien del lado del repositorio, que es quien no puede suponer nada.
//
//   audit.repository.js ya escapaba asi su filtro por username. Esta es la
//   misma logica en un solo sitio.
//
// ESCAPE: PostgreSQL usa la barra invertida como caracter de escape de LIKE
// por defecto, asi que el SQL no necesita clausula ESCAPE para que esto
// funcione. audit.repository.js la declara igualmente de forma explicita; las
// dos formas son equivalentes mientras standard_conforming_strings siga en
// 'on', que es el valor por defecto desde PostgreSQL 9.1.
// =============================================================================

/**
 * @param {*} search - Texto de busqueda tal como llega de la query string.
 * @returns {string|null} Patron '%...%' con los comodines escapados, o null si
 *   no hay nada que buscar (el SQL lo interpreta como 'sin filtro').
 */
function likePattern(search) {
  if (typeof search !== 'string') return null;
  const limpio = search.trim();
  if (limpio === '') return null;
  // Escapa el propio escape primero, si no se escaparian los escapes anadidos.
  const escapado = limpio.toLowerCase().replace(/[\\%_]/g, '\\$&');
  return `%${escapado}%`;
}

module.exports = { likePattern };
