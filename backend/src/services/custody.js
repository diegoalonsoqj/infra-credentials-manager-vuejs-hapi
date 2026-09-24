'use strict';

const { ROLE_LEVELS, PERMISSIONS } = require('../config/constants');

// =============================================================================
// services/custody.js — Quién puede ser custodio de una credencial.
//
// Una credencial custodiada solo la descifra su custodio. Antes se comprobaba
// únicamente que el custodio existiera y estuviera activo, no que
// PUDIERA descifrar. Asignársela a un VISITOR, o a alguien de un equipo sin ese
// tipo de recurso, la dejaba sin nadie capaz de abrirla. Lo mismo ocurría al
// desactivar o eliminar al custodio, o al cambiarle el rol o el equipo.
//
// Para descifrar hacen falta las mismas dos cosas que exigen la ruta y el
// servicio de descifrado:
//   - el permiso CRED_REVEAL en el rol (requirePermission de la ruta);
//   - nivel ADMIN, o un equipo que gestione ese tipo de recurso
//     (getResourceTypesForUser en credentials.service.js).
//
// Las funciones reciben `runner`: el pool ({ query }) o un cliente de
// transacción. Los dos exponen query(sql, params).
// =============================================================================

// Capacidad de descifrado de una combinación de rol y equipo.
const CAPACIDAD_SQL = `
  SELECT r.level,
         EXISTS (
           SELECT 1
           FROM sch_system.tbl_role_permissions rp
           JOIN sch_system.tbl_permissions p ON p.id = rp.permission_id
           WHERE rp.role_id = r.id AND p.code = $3
         ) AS can_reveal,
         ARRAY(
           SELECT trt.resource_type::text
           FROM sch_system.tbl_team_resource_types trt
           WHERE trt.team_id = $2
         ) AS resource_types
  FROM sch_system.tbl_roles r
  WHERE r.id = $1`;

/**
 * Capacidad de descifrado de un rol con un equipo (que puede ser null).
 *
 * @returns {Promise<{level: number, can_reveal: boolean, resource_types: string[]}|null>}
 */
async function capacidadPorRolYEquipo(runner, roleId, teamId) {
  const { rows } = await runner.query(CAPACIDAD_SQL, [roleId, teamId || null, PERMISSIONS.CRED_REVEAL]);
  return rows[0] || null;
}

/**
 * Capacidad de descifrado de un usuario, o null si no existe o no está activo.
 *
 * Con `bloquear`, retiene la fila del usuario hasta el COMMIT: entre la
 * comprobación y la escritura nadie puede desactivarlo ni cambiarle el rol.
 */
async function capacidadDeUsuario(runner, userId, { bloquear = false } = {}) {
  const { rows } = await runner.query(
    `SELECT role_id, team_id FROM sch_system.tbl_users
     WHERE id = $1 AND estado = 'AI' AND estado_registro = 'O'${bloquear ? ' FOR UPDATE' : ''}`,
    [userId]
  );
  if (!rows[0]) return null;
  return capacidadPorRolYEquipo(runner, rows[0].role_id, rows[0].team_id);
}

/**
 * Motivo por el que esa capacidad no permite descifrar credenciales del tipo
 * indicado, o null si lo permite.
 */
function motivoSinAcceso(capacidad, resourceType) {
  if (!capacidad) return 'no existe o no está activo';
  if (!capacidad.can_reveal) return `su rol no tiene el permiso ${PERMISSIONS.CRED_REVEAL}`;
  if (capacidad.level >= ROLE_LEVELS.ADMIN) return null;
  if (!(capacidad.resource_types || []).includes(resourceType)) {
    return `su equipo no gestiona recursos de tipo ${resourceType}`;
  }
  return null;
}

/** Credenciales que custodia un usuario, agrupadas por tipo de recurso. */
async function custodiadasPorTipo(runner, userId) {
  const { rows } = await runner.query(
    `SELECT resource_type, COUNT(*)::int AS total
     FROM sch_secret.tbl_credentials
     WHERE custodian_user_id = $1 AND is_custodied = TRUE AND estado_registro = 'O'
     GROUP BY resource_type
     ORDER BY resource_type`,
    [userId]
  );
  return rows;
}

// Credenciales custodiadas vivas cuyo custodio es un usuario activo con ese rol
// (o de ese equipo). `campo` es una constante de este módulo, nunca entrada.
function custodiadasPorGrupoSql(campo) {
  return `
    SELECT c.id, c.resource_type, c.username,
           COALESCE(s.code, d.code, a.code, n.code) AS instance_code,
           u.username AS custodian, u.role_id, u.team_id
    FROM sch_secret.tbl_credentials c
    JOIN sch_system.tbl_users u ON u.id = c.custodian_user_id
    LEFT JOIN sch_system.tbl_servers      s ON s.id = c.server_id
    LEFT JOIN sch_system.tbl_db_services  d ON d.id = c.db_service_id
    LEFT JOIN sch_system.tbl_applications a ON a.id = c.application_id
    LEFT JOIN sch_system.tbl_network_devices n ON n.id = c.network_device_id
    WHERE c.is_custodied = TRUE AND c.estado_registro = 'O'
      AND u.estado = 'AI' AND u.estado_registro = 'O'
      AND u.${campo} = $1
    ORDER BY u.username, c.resource_type, instance_code`;
}

/**
 * Credenciales custodiadas que quedarían sin nadie capaz de descifrarlas si
 * todos los usuarios de un rol (`roleId`) o de un equipo (`teamId`) pasan a la
 * capacidad que devuelve `cambiar(capacidadActual)`.
 *
 * Lo de arriba protege los cambios a un usuario concreto; esto cubre los que
 * afectan a
 * muchos a la vez: quitar CRED_REVEAL a un rol o un tipo de recurso a un
 * equipo. Solo cuenta las que HOY se pueden abrir: las que ya estaban
 * bloqueadas no son efecto de este cambio.
 *
 * @returns {Promise<Array<{credentialId, credential, resourceType, custodian, reason}>>}
 */
async function credencialesQueQuedarianBloqueadas(runner, { roleId, teamId }, cambiar) {
  const campo = roleId ? 'role_id' : 'team_id';
  const { rows } = await runner.query(custodiadasPorGrupoSql(campo), [roleId || teamId]);

  const capacidades = new Map();
  const bloqueadas = [];
  for (const row of rows) {
    const clave = `${row.role_id}:${row.team_id}`;
    if (!capacidades.has(clave)) {
      capacidades.set(clave, await capacidadPorRolYEquipo(runner, row.role_id, row.team_id));
    }
    const antes = capacidades.get(clave);
    if (motivoSinAcceso(antes, row.resource_type)) continue;
    const motivo = motivoSinAcceso(cambiar(antes), row.resource_type);
    if (motivo) {
      bloqueadas.push({
        credentialId: row.id,
        credential:   `${row.instance_code || '?'}/${row.username}`,
        resourceType: row.resource_type,
        custodian:    row.custodian,
        reason:       motivo,
      });
    }
  }
  return bloqueadas;
}

/** "2 de tipo DB, 1 de tipo OS", para los mensajes de error. */
function describirCustodiadas(grupos) {
  return grupos.map((g) => `${g.total} de tipo ${g.resource_type}`).join(', ');
}

module.exports = {
  capacidadPorRolYEquipo,
  capacidadDeUsuario,
  motivoSinAcceso,
  custodiadasPorTipo,
  describirCustodiadas,
  credencialesQueQuedarianBloqueadas,
};
