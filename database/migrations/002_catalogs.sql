-- =============================================================================
-- 002_catalogs.sql
-- Tablas de catálogo del sistema + datos base.
-- Incluye: ambientes, infraestructuras, roles, equipos, tipos de recurso,
--          permisos, asignaciones y catálogos de recursos.
-- Los datos base se insertan aquí para garantizar que los permisos y flags
-- is_system sean correctos desde la primera instalación.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- tbl_environment : ambientes gestionados (DEV / UAT / PRD)
-- prd_flag marca el ambiente productivo para auditoría reforzada.
-- ---------------------------------------------------------------------------
CREATE TABLE sch_system.tbl_environment (
    id              SMALLSERIAL     PRIMARY KEY,
    code            VARCHAR(10)     NOT NULL UNIQUE,
    name            VARCHAR(50)     NOT NULL,
    description     TEXT,
    prd_flag        BOOLEAN         NOT NULL DEFAULT FALSE,
    sort_order      SMALLINT        NOT NULL DEFAULT 0,
    estado_registro CHAR(1)         NOT NULL DEFAULT 'O'
                        CHECK (estado_registro IN ('O','X')),
    estado          CHAR(2)         NOT NULL DEFAULT 'AI'
                        CHECK (estado IN ('AI','IN')),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  sch_system.tbl_environment          IS 'Ambientes gestionados. prd_flag activa auditoría reforzada en accesos a ese ambiente.';
COMMENT ON COLUMN sch_system.tbl_environment.prd_flag IS 'TRUE = ambiente productivo. Activa registro de auditoría con detalle ampliado.';

INSERT INTO sch_system.tbl_environment (code, name, prd_flag, sort_order, estado_registro, estado)
VALUES
    ('DEV', 'Desarrollo', FALSE, 1, 'O', 'AI'),
    ('UAT', 'UAT',        FALSE, 2, 'O', 'AI'),
    ('PRD', 'Producción', TRUE,  3, 'O', 'AI')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- tbl_infrastructure : proveedores / tipo de infraestructura
-- ---------------------------------------------------------------------------
CREATE TABLE sch_system.tbl_infrastructure (
    id              SMALLSERIAL     PRIMARY KEY,
    code            VARCHAR(20)     NOT NULL UNIQUE,
    name            VARCHAR(100)    NOT NULL,
    description     TEXT,
    estado_registro CHAR(1)         NOT NULL DEFAULT 'O'
                        CHECK (estado_registro IN ('O','X')),
    estado          CHAR(2)         NOT NULL DEFAULT 'AI'
                        CHECK (estado IN ('AI','IN')),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE sch_system.tbl_infrastructure IS 'Proveedores de infraestructura. La app puede gestionarse en un solo proveedor pero las credenciales pueden ser de cualquiera.';

INSERT INTO sch_system.tbl_infrastructure (code, name, description, estado_registro, estado)
VALUES
    ('ONPREM', 'On-Premise',            'Datacenter local',  'O', 'AI'),
    ('GCP',    'Google Cloud Platform', 'GCP',               'O', 'AI'),
    ('AWS',    'Amazon Web Services',   'AWS',               'O', 'AI'),
    ('AZURE',  'Microsoft Azure',       'Azure',             'O', 'AI')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- tbl_roles : roles funcionales del sistema (RBAC)
-- level determina jerarquía: ADMIN(100) > OPERATOR(50) > VIEWER(20) > VISITOR(0)
-- is_system=TRUE protege el registro de eliminación/desactivación.
-- ---------------------------------------------------------------------------
CREATE TABLE sch_system.tbl_roles (
    id              SMALLSERIAL     PRIMARY KEY,
    code            VARCHAR(20)     NOT NULL UNIQUE,
    name            VARCHAR(100)    NOT NULL,
    description     TEXT,
    level           SMALLINT        NOT NULL DEFAULT 0,
    is_system       BOOLEAN         NOT NULL DEFAULT FALSE,
    estado_registro CHAR(1)         NOT NULL DEFAULT 'O'
                        CHECK (estado_registro IN ('O','X')),
    estado          CHAR(2)         NOT NULL DEFAULT 'AI'
                        CHECK (estado IN ('AI','IN')),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  sch_system.tbl_roles           IS 'Roles RBAC del sistema. El nivel numérico (level) indica jerarquía de permisos.';
COMMENT ON COLUMN sch_system.tbl_roles.level     IS 'ADMIN=100, OPERATOR=50, VIEWER=20, VISITOR=0.';
COMMENT ON COLUMN sch_system.tbl_roles.is_system IS 'TRUE = rol del sistema protegido. No puede eliminarse ni desactivarse.';

INSERT INTO sch_system.tbl_roles (code, name, level, description, is_system, estado_registro, estado)
VALUES
    ('ADMIN',    'Administrador', 100, 'Acceso total al sistema. Gestiona usuarios, catálogos y configuración.',   TRUE, 'O', 'AI'),
    ('OPERATOR', 'Operador',       50, 'Crear y editar credenciales dentro de su ámbito de equipo.',               TRUE, 'O', 'AI'),
    ('VIEWER',   'Visor',          20, 'Solo lectura dentro de su ámbito de equipo. No puede crear ni modificar.', TRUE, 'O', 'AI'),
    ('VISITOR',  'Visitante',       0, 'Sin acceso a credenciales. Solo puede usar el Generador de Contraseñas.',  TRUE, 'O', 'AI')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- tbl_teams : equipos de trabajo
-- resource_type fue reemplazado por tbl_team_resource_types (N:N).
-- is_system=TRUE protege los equipos base del sistema.
-- El UNIQUE en code es parcial: solo entre registros activos.
-- ---------------------------------------------------------------------------
CREATE TABLE sch_system.tbl_teams (
    id              SMALLSERIAL     PRIMARY KEY,
    code            VARCHAR(20)     NOT NULL,
    name            VARCHAR(100)    NOT NULL,
    description     TEXT,
    is_system       BOOLEAN         NOT NULL DEFAULT FALSE,
    estado_registro CHAR(1)         NOT NULL DEFAULT 'O'
                        CHECK (estado_registro IN ('O','X')),
    estado          CHAR(2)         NOT NULL DEFAULT 'AI'
                        CHECK (estado IN ('AI','IN')),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  sch_system.tbl_teams           IS 'Equipos de trabajo. Los tipos de recurso que gestiona cada equipo están en tbl_team_resource_types.';
COMMENT ON COLUMN sch_system.tbl_teams.is_system IS 'TRUE = equipo del sistema protegido. No puede eliminarse ni desactivarse.';

-- Índice único parcial: permite reutilizar códigos de equipos eliminados lógicamente.
CREATE UNIQUE INDEX idx_teams_code_active
    ON sch_system.tbl_teams (UPPER(code))
    WHERE estado_registro = 'O';

INSERT INTO sch_system.tbl_teams (code, name, description, is_system, estado_registro, estado)
VALUES
    ('DBA',     'Database Administrators',      'Equipo con acceso a credenciales de bases de datos.',             TRUE, 'O', 'AI'),
    ('SYSADMIN','System Administrators',        'Equipo con acceso a credenciales de servidores.',                 TRUE, 'O', 'AI'),
    ('APPOPS',  'Operadores de Aplicaciones',   'Equipo con acceso a credenciales de aplicaciones (WEB/API/SERVICE).', TRUE, 'O', 'AI')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- tbl_team_resource_types : tipos de recurso por equipo (N:N)
-- Un equipo puede gestionar credenciales de múltiples tipos de recurso.
-- ---------------------------------------------------------------------------
CREATE TABLE sch_system.tbl_team_resource_types (
    team_id       SMALLINT     NOT NULL
                      REFERENCES sch_system.tbl_teams(id) ON DELETE CASCADE,
    resource_type VARCHAR(10)  NOT NULL
                      CHECK (resource_type IN ('DB', 'OS', 'APP')),
    PRIMARY KEY (team_id, resource_type)
);

COMMENT ON TABLE  sch_system.tbl_team_resource_types             IS 'Tipos de recurso asignados a cada equipo. Un equipo puede tener uno o varios.';
COMMENT ON COLUMN sch_system.tbl_team_resource_types.resource_type IS 'DB = bases de datos, OS = servidores, APP = aplicaciones.';

INSERT INTO sch_system.tbl_team_resource_types (team_id, resource_type)
SELECT t.id, v.rt
FROM sch_system.tbl_teams t
CROSS JOIN (VALUES ('DB'), ('OS'), ('APP')) AS v(rt)
WHERE (t.code = 'DBA'     AND v.rt = 'DB')
   OR (t.code = 'SYSADMIN' AND v.rt = 'OS')
   OR (t.code = 'APPOPS'   AND v.rt = 'APP')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- tbl_permissions : catálogo de permisos granulares
-- ---------------------------------------------------------------------------
CREATE TABLE sch_system.tbl_permissions (
    id          SMALLSERIAL     PRIMARY KEY,
    code        VARCHAR(30)     NOT NULL UNIQUE,
    description VARCHAR(200)    NOT NULL
);

COMMENT ON TABLE  sch_system.tbl_permissions      IS 'Catálogo de permisos del sistema. Cada permiso habilita una acción o módulo específico.';
COMMENT ON COLUMN sch_system.tbl_permissions.code IS 'Código único del permiso. Usado en middleware requirePermission(code).';

INSERT INTO sch_system.tbl_permissions (code, description) VALUES
    ('MOD_PWDGEN',   'Generador de contraseñas'),
    ('CRED_VIEW',    'Ver listado de credenciales'),
    ('CRED_EDIT',    'Crear y editar credenciales'),
    ('CRED_DELETE',  'Eliminar credenciales'),
    ('CRED_REVEAL',  'Revelar contraseña en claro'),
    ('RES_VIEW',     'Ver recursos'),
    ('RES_EDIT',     'Crear y editar recursos'),
    ('RES_DELETE',   'Eliminar recursos'),
    ('MOD_USERS',    'Módulo gestión de usuarios'),
    ('MOD_AUDIT',    'Módulo auditoría'),
    ('MOD_CATALOGS', 'Módulo catálogos'),
    ('MOD_SECURITY', 'Módulo seguridad'),
    ('MOD_SYSTEM',   'Módulo configuración del sistema');

-- ---------------------------------------------------------------------------
-- tbl_role_permissions : asignación de permisos a roles (N:N)
-- Se inserta AQUÍ (después de roles y permisos) para que los SELECTs funcionen.
-- ---------------------------------------------------------------------------
CREATE TABLE sch_system.tbl_role_permissions (
    role_id       SMALLINT    NOT NULL
                      REFERENCES sch_system.tbl_roles(id),
    permission_id SMALLINT    NOT NULL
                      REFERENCES sch_system.tbl_permissions(id),
    PRIMARY KEY (role_id, permission_id)
);

COMMENT ON TABLE sch_system.tbl_role_permissions IS 'Relación N:M entre roles y permisos.';

-- VISITOR: solo generador de contraseñas
INSERT INTO sch_system.tbl_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM sch_system.tbl_roles r CROSS JOIN sch_system.tbl_permissions p
WHERE r.code = 'VISITOR' AND p.code IN ('MOD_PWDGEN');

-- VIEWER: ver credenciales y recursos
INSERT INTO sch_system.tbl_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM sch_system.tbl_roles r CROSS JOIN sch_system.tbl_permissions p
WHERE r.code = 'VIEWER' AND p.code IN ('MOD_PWDGEN', 'CRED_VIEW', 'RES_VIEW');

-- OPERATOR: CRUD completo de credenciales y recursos
INSERT INTO sch_system.tbl_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM sch_system.tbl_roles r CROSS JOIN sch_system.tbl_permissions p
WHERE r.code = 'OPERATOR' AND p.code IN (
    'MOD_PWDGEN',
    'CRED_VIEW', 'CRED_EDIT', 'CRED_DELETE', 'CRED_REVEAL',
    'RES_VIEW',  'RES_EDIT',  'RES_DELETE'
);

-- ADMIN: todos los permisos
INSERT INTO sch_system.tbl_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM sch_system.tbl_roles r CROSS JOIN sch_system.tbl_permissions p
WHERE r.code = 'ADMIN';

-- ---------------------------------------------------------------------------
-- Catálogos de recursos — vacíos, se llenan desde el panel de Catálogos
-- ---------------------------------------------------------------------------

CREATE TABLE sch_system.tbl_cat_os (
    id              SMALLSERIAL     PRIMARY KEY,
    code            VARCHAR(20)     NOT NULL UNIQUE,
    name            VARCHAR(100)    NOT NULL,
    sort_order      SMALLINT        NOT NULL DEFAULT 0,
    estado_registro CHAR(1)         NOT NULL DEFAULT 'O'
                        CHECK (estado_registro IN ('O','X')),
    estado          CHAR(2)         NOT NULL DEFAULT 'AI'
                        CHECK (estado IN ('AI','IN')),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE sch_system.tbl_cat_os IS 'Catálogo de sistemas operativos. Ej: Linux, Windows, Unix.';

CREATE TABLE sch_system.tbl_cat_server_product (
    id              SMALLSERIAL     PRIMARY KEY,
    code            VARCHAR(30)     NOT NULL UNIQUE,
    name            VARCHAR(100)    NOT NULL,
    sort_order      SMALLINT        NOT NULL DEFAULT 0,
    estado_registro CHAR(1)         NOT NULL DEFAULT 'O'
                        CHECK (estado_registro IN ('O','X')),
    estado          CHAR(2)         NOT NULL DEFAULT 'AI'
                        CHECK (estado IN ('AI','IN')),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE sch_system.tbl_cat_server_product IS 'Catálogo de productos/plataformas de servidor. Ej: Compute Engine, VMware VM, EC2.';

CREATE TABLE sch_system.tbl_cat_db_product (
    id              SMALLSERIAL     PRIMARY KEY,
    code            VARCHAR(30)     NOT NULL UNIQUE,
    name            VARCHAR(100)    NOT NULL,
    sort_order      SMALLINT        NOT NULL DEFAULT 0,
    estado_registro CHAR(1)         NOT NULL DEFAULT 'O'
                        CHECK (estado_registro IN ('O','X')),
    estado          CHAR(2)         NOT NULL DEFAULT 'AI'
                        CHECK (estado IN ('AI','IN')),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE sch_system.tbl_cat_db_product IS 'Catálogo de productos de BD. Ej: Cloud SQL, AlloyDB, Amazon RDS, Self-hosted.';

CREATE TABLE sch_system.tbl_cat_db_engine (
    id              SMALLSERIAL     PRIMARY KEY,
    code            VARCHAR(20)     NOT NULL UNIQUE,
    name            VARCHAR(100)    NOT NULL,
    sort_order      SMALLINT        NOT NULL DEFAULT 0,
    estado_registro CHAR(1)         NOT NULL DEFAULT 'O'
                        CHECK (estado_registro IN ('O','X')),
    estado          CHAR(2)         NOT NULL DEFAULT 'AI'
                        CHECK (estado IN ('AI','IN')),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE sch_system.tbl_cat_db_engine IS 'Catálogo de motores de BD. Ej: PostgreSQL, MySQL, Oracle, SQL Server, MongoDB.';

-- ---------------------------------------------------------------------------
-- tbl_cat_project : proyectos vinculados a infraestructura
-- Permite clasificar servidores y servicios de BD por proyecto/unidad lógica.
-- ---------------------------------------------------------------------------
CREATE TABLE sch_system.tbl_cat_project (
    id                SERIAL          PRIMARY KEY,
    code              VARCHAR(50)     NOT NULL UNIQUE,
    name              VARCHAR(200)    NOT NULL,
    infrastructure_id SMALLINT
                          REFERENCES sch_system.tbl_infrastructure(id),
    sort_order        SMALLINT        NOT NULL DEFAULT 0,
    estado_registro   CHAR(1)         NOT NULL DEFAULT 'O'
                          CHECK (estado_registro IN ('O','X')),
    estado            CHAR(2)         NOT NULL DEFAULT 'AI'
                          CHECK (estado IN ('AI','IN')),
    created_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  sch_system.tbl_cat_project                   IS 'Proyectos o unidades lógicas de infraestructura. Ej: proyecto GCP, cluster VMware, VPC AWS.';
COMMENT ON COLUMN sch_system.tbl_cat_project.infrastructure_id IS 'Proveedor al que pertenece el proyecto (GCP, AWS, On-Prem, etc.).';
