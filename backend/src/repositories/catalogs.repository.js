'use strict';

const { query, withTransaction } = require('../config/database');

// =============================================================================
// catalogs.repository.js — CRUD para tablas maestras del sistema.
//
// Catálogos editables (ADMIN): tbl_environment, tbl_infrastructure.
// Catálogos de solo lectura:   tbl_teams, tbl_roles.
//   → Sus códigos son hardcoded en constants.js y no pueden modificarse
//     sin afectar el RBAC y la lógica de ámbito de equipo.
// =============================================================================

// ---------------------------------------------------------------------------
// tbl_environment
// ---------------------------------------------------------------------------

async function findAllEnvironments() {
  const { rows } = await query(
    `SELECT id, code, name, description, prd_flag, sort_order,
            estado, estado_registro, created_at
     FROM sch_system.tbl_environment
     WHERE estado_registro = 'O'
     ORDER BY sort_order, code`
  );
  return rows;
}

async function findEnvironmentById(id) {
  const { rows } = await query(
    `SELECT id, code, name, description, prd_flag, sort_order,
            estado, estado_registro, created_at
     FROM sch_system.tbl_environment
     WHERE id = $1 AND estado_registro = 'O'`,
    [id]
  );
  return rows[0] || null;
}

async function existsEnvironmentByCode(code, excludeId = null) {
  const { rows } = await query(
    `SELECT 1 FROM sch_system.tbl_environment
     WHERE UPPER(code) = UPPER($1)
       AND estado_registro = 'O'
       AND ($2::int IS NULL OR id <> $2)
     LIMIT 1`,
    [code, excludeId]
  );
  return rows.length > 0;
}

/** Cuenta recursos (servidores + BD + apps) que referencian este ambiente. */
// Elementos vivos (no eliminados) que usan el ambiente: { kind, code, name }.
async function findEnvironmentUsages(environmentId) {
  const { rows } = await query(
    `SELECT 'SERVER' AS kind, code, name FROM sch_system.tbl_servers
      WHERE environment_id = $1 AND estado_registro = 'O'
     UNION ALL
     SELECT 'DB_SERVICE', code, name FROM sch_system.tbl_db_services
      WHERE environment_id = $1 AND estado_registro = 'O'
     UNION ALL
     SELECT 'APPLICATION', code, name FROM sch_system.tbl_applications
      WHERE environment_id = $1 AND estado_registro = 'O'
     ORDER BY 1, 2`,
    [environmentId]
  );
  return rows;
}

async function createEnvironment({ code, name, description, prdFlag, sortOrder }) {
  const { rows } = await query(
    `INSERT INTO sch_system.tbl_environment (code, name, description, prd_flag, sort_order)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, code, name, prd_flag, sort_order, estado`,
    [code.trim().toUpperCase(), name.trim(), description || null, prdFlag || false, sortOrder || 0]
  );
  return rows[0];
}

async function updateEnvironment(id, { name, description, prdFlag, sortOrder }) {
  const { rows } = await query(
    `UPDATE sch_system.tbl_environment
     SET name = $2, description = $3, prd_flag = $4, sort_order = $5
     WHERE id = $1 AND estado_registro = 'O'
     RETURNING id, code, name, prd_flag, sort_order, estado`,
    [id, name.trim(), description || null, prdFlag || false, sortOrder ?? 0]
  );
  return rows[0] || null;
}

async function toggleEnvironmentEstado(id) {
  const { rows } = await query(
    `UPDATE sch_system.tbl_environment
     SET estado = CASE WHEN estado = 'AI' THEN 'IN' ELSE 'AI' END
     WHERE id = $1 AND estado_registro = 'O'
     RETURNING id, code, estado`,
    [id]
  );
  return rows[0] || null;
}

async function softDeleteEnvironment(id) {
  const { rows } = await query(
    `UPDATE sch_system.tbl_environment
     SET estado_registro = 'X', estado = 'IN'
     WHERE id = $1 AND estado_registro = 'O'
     RETURNING id, code`,
    [id]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// tbl_infrastructure
// ---------------------------------------------------------------------------

async function findAllInfrastructures() {
  const { rows } = await query(
    `SELECT id, code, name, description, estado, estado_registro, created_at
     FROM sch_system.tbl_infrastructure
     WHERE estado_registro = 'O'
     ORDER BY code`
  );
  return rows;
}

async function findInfrastructureById(id) {
  const { rows } = await query(
    `SELECT id, code, name, description, estado, estado_registro, created_at
     FROM sch_system.tbl_infrastructure
     WHERE id = $1 AND estado_registro = 'O'`,
    [id]
  );
  return rows[0] || null;
}

async function existsInfrastructureByCode(code, excludeId = null) {
  const { rows } = await query(
    `SELECT 1 FROM sch_system.tbl_infrastructure
     WHERE UPPER(code) = UPPER($1)
       AND estado_registro = 'O'
       AND ($2::int IS NULL OR id <> $2)
     LIMIT 1`,
    [code, excludeId]
  );
  return rows.length > 0;
}

/** Cuenta recursos (servidores + BD) que referencian esta infraestructura. */
// Elementos vivos que usan la infraestructura. Incluye los proyectos: antes
// solo se contaban servidores y servicios de BD, y se podía borrar una
// infraestructura con proyectos activos apuntando a ella.
async function findInfrastructureUsages(infrastructureId) {
  const { rows } = await query(
    `SELECT 'SERVER' AS kind, code, name FROM sch_system.tbl_servers
      WHERE infrastructure_id = $1 AND estado_registro = 'O'
     UNION ALL
     SELECT 'DB_SERVICE', code, name FROM sch_system.tbl_db_services
      WHERE infrastructure_id = $1 AND estado_registro = 'O'
     UNION ALL
     SELECT 'PROJECT', code, name FROM sch_system.tbl_cat_project
      WHERE infrastructure_id = $1 AND estado_registro = 'O'
     ORDER BY 1, 2`,
    [infrastructureId]
  );
  return rows;
}

async function createInfrastructure({ code, name, description }) {
  const { rows } = await query(
    `INSERT INTO sch_system.tbl_infrastructure (code, name, description)
     VALUES ($1, $2, $3)
     RETURNING id, code, name, description, estado`,
    [code.trim().toUpperCase(), name.trim(), description || null]
  );
  return rows[0];
}

async function updateInfrastructure(id, { name, description }) {
  const { rows } = await query(
    `UPDATE sch_system.tbl_infrastructure
     SET name = $2, description = $3
     WHERE id = $1 AND estado_registro = 'O'
     RETURNING id, code, name, description, estado`,
    [id, name.trim(), description || null]
  );
  return rows[0] || null;
}

async function toggleInfrastructureEstado(id) {
  const { rows } = await query(
    `UPDATE sch_system.tbl_infrastructure
     SET estado = CASE WHEN estado = 'AI' THEN 'IN' ELSE 'AI' END
     WHERE id = $1 AND estado_registro = 'O'
     RETURNING id, code, estado`,
    [id]
  );
  return rows[0] || null;
}

async function softDeleteInfrastructure(id) {
  const { rows } = await query(
    `UPDATE sch_system.tbl_infrastructure
     SET estado_registro = 'X', estado = 'IN'
     WHERE id = $1 AND estado_registro = 'O'
     RETURNING id, code`,
    [id]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// tbl_roles — CRUD completo
// ---------------------------------------------------------------------------

async function findAllRoles() {
  const { rows } = await query(
    `SELECT id, code, name, level, description, is_system, estado, estado_registro, created_at
     FROM sch_system.tbl_roles
     WHERE estado_registro = 'O'
     ORDER BY level DESC`
  );
  return rows;
}

async function findRoleById(id) {
  const { rows } = await query(
    `SELECT id, code, name, level, description, is_system, estado, estado_registro, created_at
     FROM sch_system.tbl_roles
     WHERE id = $1 AND estado_registro = 'O'`,
    [id]
  );
  return rows[0] || null;
}

async function existsRoleByCode(code, excludeId = null) {
  const { rows } = await query(
    `SELECT 1 FROM sch_system.tbl_roles
     WHERE UPPER(code) = UPPER($1)
       AND estado_registro = 'O'
       AND ($2::int IS NULL OR id <> $2)
     LIMIT 1`,
    [code, excludeId]
  );
  return rows.length > 0;
}

async function countUsersByRole(roleId) {
  const { rows } = await query(
    `SELECT COUNT(*) AS total
     FROM sch_system.tbl_users
     WHERE role_id = $1 AND estado_registro = 'O'`,
    [roleId]
  );
  return parseInt(rows[0].total, 10);
}

async function createRole({ code, name, level, description }) {
  const { rows } = await query(
    `INSERT INTO sch_system.tbl_roles (code, name, level, description)
     VALUES ($1, $2, $3, $4)
     RETURNING id, code, name, level, description, is_system, estado`,
    [code.trim().toUpperCase(), name.trim(), level, description || null]
  );
  return rows[0];
}

async function updateRole(id, { name, description }) {
  const { rows } = await query(
    `UPDATE sch_system.tbl_roles
     SET name = $2, description = $3
     WHERE id = $1 AND estado_registro = 'O'
     RETURNING id, code, name, level, description, is_system, estado`,
    [id, name.trim(), description || null]
  );
  return rows[0] || null;
}

async function toggleRoleEstado(id) {
  const { rows } = await query(
    `UPDATE sch_system.tbl_roles
     SET estado = CASE WHEN estado = 'AI' THEN 'IN' ELSE 'AI' END
     WHERE id = $1 AND estado_registro = 'O'
     RETURNING id, code, estado`,
    [id]
  );
  return rows[0] || null;
}

async function softDeleteRole(id) {
  const { rows } = await query(
    `UPDATE sch_system.tbl_roles
     SET estado_registro = 'X', estado = 'IN'
     WHERE id = $1 AND estado_registro = 'O'
     RETURNING id, code`,
    [id]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// tbl_teams — CRUD completo
// ---------------------------------------------------------------------------

async function findAllTeams() {
  const { rows } = await query(
    `SELECT t.id, t.code, t.name, t.description, t.is_system, t.estado, t.estado_registro, t.created_at,
            COALESCE(
              ARRAY_AGG(trt.resource_type ORDER BY trt.resource_type) FILTER (WHERE trt.resource_type IS NOT NULL),
              ARRAY[]::varchar[]
            ) AS resource_types
     FROM sch_system.tbl_teams t
     LEFT JOIN sch_system.tbl_team_resource_types trt ON trt.team_id = t.id
     WHERE t.estado_registro = 'O'
     GROUP BY t.id, t.code, t.name, t.description, t.is_system, t.estado, t.estado_registro, t.created_at
     ORDER BY t.code`
  );
  return rows;
}

async function findTeamById(id) {
  const { rows } = await query(
    `SELECT t.id, t.code, t.name, t.description, t.is_system, t.estado, t.estado_registro, t.created_at,
            COALESCE(
              ARRAY_AGG(trt.resource_type ORDER BY trt.resource_type) FILTER (WHERE trt.resource_type IS NOT NULL),
              ARRAY[]::varchar[]
            ) AS resource_types
     FROM sch_system.tbl_teams t
     LEFT JOIN sch_system.tbl_team_resource_types trt ON trt.team_id = t.id
     WHERE t.id = $1 AND t.estado_registro = 'O'
     GROUP BY t.id, t.code, t.name, t.description, t.is_system, t.estado, t.estado_registro, t.created_at`,
    [id]
  );
  return rows[0] || null;
}

async function existsTeamByCode(code, excludeId = null) {
  const { rows } = await query(
    `SELECT 1 FROM sch_system.tbl_teams
     WHERE UPPER(code) = UPPER($1)
       AND estado_registro = 'O'
       AND ($2::int IS NULL OR id <> $2)
     LIMIT 1`,
    [code, excludeId]
  );
  return rows.length > 0;
}

async function countUsersByTeam(teamId) {
  const { rows } = await query(
    `SELECT COUNT(*) AS total
     FROM sch_system.tbl_users
     WHERE team_id = $1 AND estado_registro = 'O'`,
    [teamId]
  );
  return parseInt(rows[0].total, 10);
}

// Crear y editar un equipo van en una transacción. Antes eran sentencias
// sueltas, cada una por su conexión del pool:
//   - si fallaba un INSERT de tipos, el equipo quedaba creado sin ellos, o
//     editado con los tipos borrados y solo parte de los nuevos;
//   - entre el DELETE y los INSERT de la edición, cualquier petición de un
//     miembro del equipo veía un equipo sin tipos y recibía 403.
// Lo segundo es un parpadeo; lo primero dejaba a todo el equipo sin acceso
// hasta que alguien volviera a guardar. El ámbito falla cerrado, así que no
// abría accesos: los cortaba.
async function createTeam({ code, name, resourceTypes, description }) {
  return withTransaction(async (client) => {
    // Insertar equipo (sin resource_type, ahora en junction table)
    const { rows } = await client.query(
      `INSERT INTO sch_system.tbl_teams (code, name, description)
       VALUES ($1, $2, $3)
       RETURNING id, code, name, description, is_system, estado`,
      [code.trim().toUpperCase(), name.trim(), description || null]
    );
    const team = rows[0];

    // Insertar tipos de recurso en junction table
    for (const rt of resourceTypes) {
      await client.query(
        `INSERT INTO sch_system.tbl_team_resource_types (team_id, resource_type) VALUES ($1, $2)`,
        [team.id, rt]
      );
    }

    team.resource_types = [...resourceTypes].sort();
    return team;
  });
}

async function updateTeam(id, { name, description, resourceTypes }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE sch_system.tbl_teams
       SET name = $2, description = $3
       WHERE id = $1 AND estado_registro = 'O'
       RETURNING id, code, name, description, is_system, estado`,
      [id, name.trim(), description || null]
    );
    const team = rows[0];
    if (!team) return null;

    // Reemplazar tipos de recurso (delete + insert)
    await client.query(`DELETE FROM sch_system.tbl_team_resource_types WHERE team_id = $1`, [id]);
    for (const rt of resourceTypes) {
      await client.query(
        `INSERT INTO sch_system.tbl_team_resource_types (team_id, resource_type) VALUES ($1, $2)`,
        [id, rt]
      );
    }

    team.resource_types = [...resourceTypes].sort();
    return team;
  });
}

async function toggleTeamEstado(id) {
  const { rows } = await query(
    `UPDATE sch_system.tbl_teams
     SET estado = CASE WHEN estado = 'AI' THEN 'IN' ELSE 'AI' END
     WHERE id = $1 AND estado_registro = 'O'
     RETURNING id, code, estado`,
    [id]
  );
  return rows[0] || null;
}

async function softDeleteTeam(id) {
  const { rows } = await query(
    `UPDATE sch_system.tbl_teams
     SET estado_registro = 'X', estado = 'IN'
     WHERE id = $1 AND estado_registro = 'O'
     RETURNING id, code`,
    [id]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// tbl_permissions + tbl_role_permissions
// ---------------------------------------------------------------------------

async function findAllPermissions() {
  const { rows } = await query(
    `SELECT id, code, description FROM sch_system.tbl_permissions ORDER BY code`
  );
  return rows;
}

async function findPermissionsByRoleId(roleId) {
  const { rows } = await query(
    `SELECT p.id, p.code, p.description
     FROM sch_system.tbl_role_permissions rp
     JOIN sch_system.tbl_permissions p ON p.id = rp.permission_id
     WHERE rp.role_id = $1
     ORDER BY p.code`,
    [roleId]
  );
  return rows;
}

async function assignPermissionToRole(roleId, permissionId) {
  await query(
    `INSERT INTO sch_system.tbl_role_permissions (role_id, permission_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [roleId, permissionId]
  );
}

async function revokePermissionFromRole(roleId, permissionId) {
  await query(
    `DELETE FROM sch_system.tbl_role_permissions
     WHERE role_id = $1 AND permission_id = $2`,
    [roleId, permissionId]
  );
}

async function setRolePermissions(roleId, permissionIds) {
  // Reemplaza todos los permisos del rol en una sola transacción
  return withTransaction(async (client) => {
    await client.query(
      `DELETE FROM sch_system.tbl_role_permissions WHERE role_id = $1`,
      [roleId]
    );
    if (permissionIds.length > 0) {
      const values = permissionIds.map((pid, i) => `($1, $${i + 2})`).join(', ');
      await client.query(
        `INSERT INTO sch_system.tbl_role_permissions (role_id, permission_id) VALUES ${values}`,
        [roleId, ...permissionIds]
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Catálogos de recursos: OS, Producto servidor, Producto BD, Motor BD
// Patrón común: findAll, findById, existsByCode, create, update, toggle, softDelete
// ---------------------------------------------------------------------------

const CATALOG_TABLE_WHITELIST = new Set([
  'tbl_cat_os',
  'tbl_cat_server_product',
  'tbl_cat_db_product',
  'tbl_cat_db_engine',
]);

// Quién referencia a cada catálogo. Se usa para contar dependientes antes de
// eliminar, igual que hacen findEnvironmentUsages, countUsersByRole o
// findProjectUsages en los catálogos que no pasan por esta fábrica.
//
// Los nombres son constantes del módulo, nunca entrada del request, pero se
// validan igual contra lista blanca antes de interpolarse en el SQL.
const USAGE_TABLE_WHITELIST = new Set(['tbl_servers', 'tbl_db_services']);
const USAGE_COLUMN_WHITELIST = new Set(['os_id', 'product_id', 'engine_id']);

/**
 * @param {string} table      - Tabla del catálogo (lista blanca).
 * @param {string} codePrefix - Prefijo del código autogenerado.
 * @param {{table: string, column: string, label: string}} usage
 *        Tabla y columna que referencian a este catálogo, y cómo nombrarlas
 *        en el mensaje de error.
 */
function makeCatalogRepo(table, codePrefix, usage) {
  if (!CATALOG_TABLE_WHITELIST.has(table)) {
    throw new Error(`makeCatalogRepo: tabla no permitida: "${table}"`);
  }
  if (!usage || !USAGE_TABLE_WHITELIST.has(usage.table) || !USAGE_COLUMN_WHITELIST.has(usage.column)) {
    throw new Error(`makeCatalogRepo: referencia no permitida para "${table}"`);
  }
  return {
    /** Cuántos registros vivos apuntan a esta entrada del catálogo. */
    async countUsages(id) {
      const { rows } = await query(
        `SELECT COUNT(*) AS total
         FROM sch_system.${usage.table}
         WHERE ${usage.column} = $1 AND estado_registro = 'O'`,
        [id]
      );
      return parseInt(rows[0].total, 10);
    },
    usageLabel: usage.label,
    async findAll() {
      const { rows } = await query(
        `SELECT id, code, name, sort_order, estado, estado_registro, created_at
         FROM sch_system.${table}
         WHERE estado_registro = 'O'
         ORDER BY sort_order, name`
      );
      return rows;
    },
    async findById(id) {
      const { rows } = await query(
        `SELECT id, code, name, sort_order, estado, estado_registro, created_at
         FROM sch_system.${table} WHERE id = $1 AND estado_registro = 'O'`,
        [id]
      );
      return rows[0] || null;
    },
    async existsByCode(code, excludeId = null) {
      const { rows } = await query(
        `SELECT 1 FROM sch_system.${table}
         WHERE UPPER(code) = UPPER($1) AND estado_registro = 'O'
           AND ($2::int IS NULL OR id <> $2) LIMIT 1`,
        [code, excludeId]
      );
      return rows.length > 0;
    },
    async create({ name, sortOrder }) {
      // INSERT con placeholder temporal, luego UPDATE al código definitivo {PREFIX}-{NNNN}.
      // Dos queries porque en PostgreSQL el UPDATE de un CTE no ve filas insertadas
      // en el mismo statement (mismo snapshot).
      const { rows: [ins] } = await query(
        `INSERT INTO sch_system.${table} (code, name, sort_order)
         VALUES (LEFT(gen_random_uuid()::text, 20), $1, $2)
         RETURNING id`,
        [name.trim(), sortOrder || 0]
      );
      const { rows } = await query(
        `UPDATE sch_system.${table}
         SET code = $2
         WHERE id = $1
         RETURNING id, code, name, sort_order, estado`,
        [ins.id, `${codePrefix}-${String(ins.id).padStart(4, '0')}`]
      );
      return rows[0];
    },
    async update(id, { name, sortOrder }) {
      const { rows } = await query(
        `UPDATE sch_system.${table}
         SET name = $2, sort_order = $3
         WHERE id = $1 AND estado_registro = 'O'
         RETURNING id, code, name, sort_order, estado`,
        [id, name.trim(), sortOrder ?? 0]
      );
      return rows[0] || null;
    },
    async toggle(id) {
      const { rows } = await query(
        `UPDATE sch_system.${table}
         SET estado = CASE WHEN estado = 'AI' THEN 'IN' ELSE 'AI' END
         WHERE id = $1 AND estado_registro = 'O'
         RETURNING id, code, estado`,
        [id]
      );
      return rows[0] || null;
    },
    async softDelete(id) {
      const { rows } = await query(
        `UPDATE sch_system.${table}
         SET estado_registro = 'X', estado = 'IN'
         WHERE id = $1 AND estado_registro = 'O'
         RETURNING id, code`,
        [id]
      );
      return rows[0] || null;
    },
  };
}

const osRepo            = makeCatalogRepo('tbl_cat_os',             'OS',
  { table: 'tbl_servers',     column: 'os_id',      label: 'servidor(es)' });
const serverProductRepo = makeCatalogRepo('tbl_cat_server_product', 'SP',
  { table: 'tbl_servers',     column: 'product_id', label: 'servidor(es)' });
const dbProductRepo     = makeCatalogRepo('tbl_cat_db_product',     'DBP',
  { table: 'tbl_db_services', column: 'product_id', label: 'servicio(s) de base de datos' });
const dbEngineRepo      = makeCatalogRepo('tbl_cat_db_engine',      'DBE',
  { table: 'tbl_db_services', column: 'engine_id',  label: 'servicio(s) de base de datos' });

// ---------------------------------------------------------------------------
// tbl_cat_project — proyectos por infraestructura
// No usa makeCatalogRepo porque tiene el campo infrastructure_id extra.
// ---------------------------------------------------------------------------

async function findAllProjects(infrastructureId = null) {
  const { rows } = await query(
    `SELECT p.id, p.code, p.name, p.sort_order, p.estado, p.estado_registro, p.created_at,
            p.infrastructure_id,
            i.code AS infrastructure_code, i.name AS infrastructure_name
     FROM sch_system.tbl_cat_project p
     LEFT JOIN sch_system.tbl_infrastructure i ON i.id = p.infrastructure_id
     WHERE p.estado_registro = 'O'
       AND ($1::int IS NULL OR p.infrastructure_id = $1)
     ORDER BY p.sort_order, p.name`,
    [infrastructureId || null]
  );
  return rows;
}

async function findProjectById(id) {
  const { rows } = await query(
    `SELECT p.id, p.code, p.name, p.sort_order, p.estado, p.estado_registro, p.created_at,
            p.infrastructure_id,
            i.code AS infrastructure_code, i.name AS infrastructure_name
     FROM sch_system.tbl_cat_project p
     LEFT JOIN sch_system.tbl_infrastructure i ON i.id = p.infrastructure_id
     WHERE p.id = $1 AND p.estado_registro = 'O'`,
    [id]
  );
  return rows[0] || null;
}

async function existsProjectByCode(code, excludeId = null) {
  const { rows } = await query(
    `SELECT 1 FROM sch_system.tbl_cat_project
     WHERE UPPER(code) = UPPER($1) AND estado_registro = 'O'
       AND ($2::int IS NULL OR id <> $2) LIMIT 1`,
    [code, excludeId]
  );
  return rows.length > 0;
}

// Elementos vivos que usan el proyecto.
async function findProjectUsages(projectId) {
  const { rows } = await query(
    `SELECT 'SERVER' AS kind, code, name FROM sch_system.tbl_servers
      WHERE project_id = $1 AND estado_registro = 'O'
     UNION ALL
     SELECT 'DB_SERVICE', code, name FROM sch_system.tbl_db_services
      WHERE project_id = $1 AND estado_registro = 'O'
     ORDER BY 1, 2`,
    [projectId]
  );
  return rows;
}

async function createProject({ name, infrastructureId, sortOrder }) {
  const { rows: [ins] } = await query(
    `INSERT INTO sch_system.tbl_cat_project (code, name, infrastructure_id, sort_order)
     VALUES (LEFT(gen_random_uuid()::text, 20), $1, $2, $3)
     RETURNING id`,
    [name.trim(), infrastructureId || null, sortOrder || 0]
  );
  const { rows } = await query(
    `UPDATE sch_system.tbl_cat_project
     SET code = $2
     WHERE id = $1
     RETURNING id, code, name, infrastructure_id, sort_order, estado`,
    [ins.id, `PRJ-${String(ins.id).padStart(4, '0')}`]
  );
  return rows[0];
}

async function updateProject(id, { name, infrastructureId, sortOrder }) {
  const { rows } = await query(
    `UPDATE sch_system.tbl_cat_project
     SET name = $2, infrastructure_id = $3, sort_order = $4
     WHERE id = $1 AND estado_registro = 'O'
     RETURNING id, code, name, infrastructure_id, sort_order, estado`,
    [id, name.trim(), infrastructureId || null, sortOrder ?? 0]
  );
  return rows[0] || null;
}

async function toggleProjectEstado(id) {
  const { rows } = await query(
    `UPDATE sch_system.tbl_cat_project
     SET estado = CASE WHEN estado = 'AI' THEN 'IN' ELSE 'AI' END
     WHERE id = $1 AND estado_registro = 'O'
     RETURNING id, code, estado`,
    [id]
  );
  return rows[0] || null;
}

async function softDeleteProject(id) {
  const { rows } = await query(
    `UPDATE sch_system.tbl_cat_project
     SET estado_registro = 'X', estado = 'IN'
     WHERE id = $1 AND estado_registro = 'O'
     RETURNING id, code`,
    [id]
  );
  return rows[0] || null;
}

module.exports = {
  // Environments
  findAllEnvironments, findEnvironmentById,
  existsEnvironmentByCode, findEnvironmentUsages,
  createEnvironment, updateEnvironment,
  toggleEnvironmentEstado, softDeleteEnvironment,
  // Infrastructures
  findAllInfrastructures, findInfrastructureById,
  existsInfrastructureByCode, findInfrastructureUsages,
  createInfrastructure, updateInfrastructure,
  toggleInfrastructureEstado, softDeleteInfrastructure,
  // Roles
  findAllRoles, findRoleById, existsRoleByCode, countUsersByRole,
  createRole, updateRole, toggleRoleEstado, softDeleteRole,
  // Teams
  findAllTeams, findTeamById, existsTeamByCode, countUsersByTeam,
  createTeam, updateTeam, toggleTeamEstado, softDeleteTeam,
  // Permissions
  findAllPermissions, findPermissionsByRoleId,
  assignPermissionToRole, revokePermissionFromRole, setRolePermissions,
  // Catálogos de recursos
  osRepo, serverProductRepo, dbProductRepo, dbEngineRepo,
  // Proyectos
  findAllProjects, findProjectById, existsProjectByCode, findProjectUsages,
  createProject, updateProject, toggleProjectEstado, softDeleteProject,
};
