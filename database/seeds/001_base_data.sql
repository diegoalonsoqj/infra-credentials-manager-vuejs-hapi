-- =============================================================================
-- 001_base_data.sql
-- Seeds de datos base del sistema. Ejecutados por el wizard en el paso 4.
-- Idempotente: usa ON CONFLICT DO NOTHING para re-ejecuciones seguras.
--
-- Nota: los datos base (ambientes, infraestructuras, roles, equipos, permisos)
-- ya son insertados por 002_catalogs.sql durante las migraciones. Este seed
-- actúa como capa de seguridad adicional para garantizar su existencia.
-- =============================================================================

-- Ambientes
INSERT INTO sch_system.tbl_environment
    (code, name, prd_flag, sort_order, estado_registro, estado)
VALUES
    ('DEV', 'Desarrollo', FALSE, 1, 'O', 'AI'),
    ('UAT', 'UAT',        FALSE, 2, 'O', 'AI'),
    ('PRD', 'Producción', TRUE,  3, 'O', 'AI')
ON CONFLICT (code) DO NOTHING;

-- Infraestructuras
INSERT INTO sch_system.tbl_infrastructure
    (code, name, description, estado_registro, estado)
VALUES
    ('ONPREM', 'On-Premise',            'Datacenter local',  'O', 'AI'),
    ('GCP',    'Google Cloud Platform', 'GCP',               'O', 'AI'),
    ('AWS',    'Amazon Web Services',   'AWS',               'O', 'AI'),
    ('AZURE',  'Microsoft Azure',       'Azure',             'O', 'AI')
ON CONFLICT (code) DO NOTHING;

-- Roles base (is_system=TRUE protege estos roles de eliminación/desactivación)
INSERT INTO sch_system.tbl_roles
    (code, name, level, description, is_system, estado_registro, estado)
VALUES
    ('ADMIN',    'Administrador', 100, 'Acceso total al sistema.',                                       TRUE, 'O', 'AI'),
    ('OPERATOR', 'Operador',       50, 'Crear y editar credenciales dentro de su ámbito de equipo.',    TRUE, 'O', 'AI'),
    ('VIEWER',   'Visor',          20, 'Solo lectura dentro de su ámbito de equipo.',                   TRUE, 'O', 'AI'),
    ('VISITOR',  'Visitante',       0, 'Sin acceso a credenciales. Solo el Generador de Contraseñas.',  TRUE, 'O', 'AI')
ON CONFLICT (code) DO NOTHING;

-- Equipos base (sin resource_type — ahora está en tbl_team_resource_types)
INSERT INTO sch_system.tbl_teams
    (code, name, description, is_system, estado_registro, estado)
VALUES
    ('DBA',     'Database Administrators',    'Equipo con acceso a credenciales de bases de datos.',              TRUE, 'O', 'AI'),
    ('SYSADMIN','System Administrators',      'Equipo con acceso a credenciales de servidores.',                  TRUE, 'O', 'AI'),
    ('APPOPS',  'Operadores de Aplicaciones', 'Equipo con acceso a credenciales de aplicaciones (WEB/API/SERVICE).', TRUE, 'O', 'AI')
ON CONFLICT DO NOTHING;

-- Tipos de recurso por equipo
INSERT INTO sch_system.tbl_team_resource_types (team_id, resource_type)
SELECT t.id, v.rt
FROM sch_system.tbl_teams t
CROSS JOIN (VALUES ('DB'), ('OS'), ('APP')) AS v(rt)
WHERE (t.code = 'DBA'      AND v.rt = 'DB')
   OR (t.code = 'SYSADMIN' AND v.rt = 'OS')
   OR (t.code = 'APPOPS'   AND v.rt = 'APP')
ON CONFLICT DO NOTHING;
