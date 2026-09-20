-- =============================================================================
-- 004_resources.sql
-- Recursos del sistema: servidores, servicios de BD y aplicaciones.
-- Modelo plano: un registro = un recurso en un ambiente específico.
-- Depende de: 002_catalogs.sql, 003_users_sessions_settings.sql
-- =============================================================================

-- ---------------------------------------------------------------------------
-- tbl_servers : servidores físicos/virtuales (modelo plano)
-- Un registro = un servidor en un ambiente e infraestructura específicos.
-- project_id vincula el servidor al proyecto/unidad lógica de infraestructura.
-- ---------------------------------------------------------------------------
CREATE TABLE sch_system.tbl_servers (
    id                  SERIAL          PRIMARY KEY,
    code                VARCHAR(50)     NOT NULL UNIQUE,
    hostname            VARCHAR(200)    NOT NULL,
    name                VARCHAR(200)    NOT NULL,
    ip_address          INET,
    infrastructure_id   SMALLINT
                            REFERENCES sch_system.tbl_infrastructure(id),
    environment_id      SMALLINT        NOT NULL
                            REFERENCES sch_system.tbl_environment(id),
    project_id          INT
                            REFERENCES sch_system.tbl_cat_project(id),
    product_id          SMALLINT
                            REFERENCES sch_system.tbl_cat_server_product(id),
    os_id               SMALLINT
                            REFERENCES sch_system.tbl_cat_os(id),
    description         TEXT,
    estado_registro     CHAR(1)         NOT NULL DEFAULT 'O'
                            CHECK (estado_registro IN ('O','X')),
    estado              CHAR(2)         NOT NULL DEFAULT 'AI'
                            CHECK (estado IN ('AI','IN')),
    created_by          UUID
                            REFERENCES sch_system.tbl_users(id),
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  sch_system.tbl_servers           IS 'Servidores físicos/virtuales. Un registro = un servidor en un ambiente específico.';
COMMENT ON COLUMN sch_system.tbl_servers.ip_address  IS 'IP del servidor. Tipo INET valida el formato automáticamente.';
COMMENT ON COLUMN sch_system.tbl_servers.project_id  IS 'Proyecto GCP, cluster VMware u otra unidad lógica de infraestructura.';

CREATE INDEX idx_servers_environment_id
    ON sch_system.tbl_servers (environment_id);

CREATE INDEX idx_servers_infrastructure_id
    ON sch_system.tbl_servers (infrastructure_id)
    WHERE infrastructure_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- tbl_db_services : servicios de base de datos (modelo plano)
-- server_id es NULL si es cloud-managed (Cloud SQL, RDS, Atlas, etc.).
-- project_id vincula el servicio al proyecto/unidad lógica de infraestructura.
-- ---------------------------------------------------------------------------
CREATE TABLE sch_system.tbl_db_services (
    id                  SERIAL          PRIMARY KEY,
    code                VARCHAR(50)     NOT NULL UNIQUE,
    name                VARCHAR(200)    NOT NULL,
    host                VARCHAR(300)    NOT NULL,
    port                SMALLINT,
    infrastructure_id   SMALLINT
                            REFERENCES sch_system.tbl_infrastructure(id),
    environment_id      SMALLINT        NOT NULL
                            REFERENCES sch_system.tbl_environment(id),
    project_id          INT
                            REFERENCES sch_system.tbl_cat_project(id),
    product_id          SMALLINT
                            REFERENCES sch_system.tbl_cat_db_product(id),
    engine_id           SMALLINT
                            REFERENCES sch_system.tbl_cat_db_engine(id),
    server_id           INT
                            REFERENCES sch_system.tbl_servers(id),
    description         TEXT,
    estado_registro     CHAR(1)         NOT NULL DEFAULT 'O'
                            CHECK (estado_registro IN ('O','X')),
    estado              CHAR(2)         NOT NULL DEFAULT 'AI'
                            CHECK (estado IN ('AI','IN')),
    created_by          UUID
                            REFERENCES sch_system.tbl_users(id),
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  sch_system.tbl_db_services           IS 'Servicios de base de datos. server_id=NULL si es cloud-managed (Cloud SQL, RDS, Atlas).';
COMMENT ON COLUMN sch_system.tbl_db_services.host      IS 'IP, FQDN o connection string del servicio.';
COMMENT ON COLUMN sch_system.tbl_db_services.server_id IS 'NULL si es cloud-managed. FK a tbl_servers si corre en servidor propio.';
COMMENT ON COLUMN sch_system.tbl_db_services.project_id IS 'Proyecto GCP, cluster VMware u otra unidad lógica de infraestructura.';

CREATE INDEX idx_db_services_environment_id
    ON sch_system.tbl_db_services (environment_id);

CREATE INDEX idx_db_services_server_id
    ON sch_system.tbl_db_services (server_id)
    WHERE server_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- tbl_applications : aplicaciones web/API/servicio (modelo plano)
-- server_id es NULL si es SaaS externo o cloud sin servidor propio registrado.
-- ---------------------------------------------------------------------------
CREATE TABLE sch_system.tbl_applications (
    id                  SERIAL          PRIMARY KEY,
    code                VARCHAR(50)     NOT NULL UNIQUE,
    name                VARCHAR(200)    NOT NULL,
    app_type            VARCHAR(10)     NOT NULL DEFAULT 'WEB'
                            CHECK (app_type IN ('WEB','API','SERVICE','OTHER')),
    url                 VARCHAR(500),
    environment_id      SMALLINT        NOT NULL
                            REFERENCES sch_system.tbl_environment(id),
    server_id           INT
                            REFERENCES sch_system.tbl_servers(id),
    description         TEXT,
    estado_registro     CHAR(1)         NOT NULL DEFAULT 'O'
                            CHECK (estado_registro IN ('O','X')),
    estado              CHAR(2)         NOT NULL DEFAULT 'AI'
                            CHECK (estado IN ('AI','IN')),
    created_by          UUID
                            REFERENCES sch_system.tbl_users(id),
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  sch_system.tbl_applications           IS 'Aplicaciones WEB/API/SERVICE. server_id=NULL si es SaaS externo o cloud sin servidor propio.';
COMMENT ON COLUMN sch_system.tbl_applications.server_id IS 'NULL si es SaaS (Jira, GitHub, etc.) o cloud. FK a tbl_servers si está en servidor propio.';

CREATE INDEX idx_applications_environment_id
    ON sch_system.tbl_applications (environment_id);

CREATE INDEX idx_applications_server_id
    ON sch_system.tbl_applications (server_id)
    WHERE server_id IS NOT NULL;
