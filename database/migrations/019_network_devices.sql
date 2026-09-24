-- =============================================================================
-- 019_network_devices.sql
--
-- Cuarto tipo de recurso: NET, dispositivos de red (routers, switches,
-- firewalls, puntos de acceso…), gestionados por el equipo NETOPS igual que
-- DBA gestiona las bases de datos o SYSADMIN los servidores.
--
-- Un dispositivo se registra como cualquier otro recurso: código, nombre, IP o
-- host, puerto, ambiente e infraestructura. Lo propio es su catálogo de
-- producto (tbl_cat_network_product), editable desde Catálogos. Sus
-- credenciales son usuario y contraseña, como las del resto de tipos: el
-- cifrado, la custodia, el descifrado y la auditoría no cambian.
--
-- Cambios:
--   - tbl_cat_network_product y tbl_network_devices (nuevas).
--   - tbl_credentials.network_device_id y la regla "exactamente un recurso"
--     (chk_resource_xor) con la cuarta columna.
--   - 'NET' en los CHECK de resource_type de credenciales, tipos por equipo y
--     auditoría (activa e histórico). CHAR(3) en auditoría ya admite 'NET'.
--   - Equipo NETOPS con el tipo NET.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- tbl_cat_network_product — producto o fabricante del dispositivo
-- Misma estructura que tbl_cat_server_product: lo gestiona la fábrica de
-- catálogos (catalogs.repository.js).
-- ---------------------------------------------------------------------------
CREATE TABLE sch_system.tbl_cat_network_product (
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
COMMENT ON TABLE sch_system.tbl_cat_network_product IS 'Catálogo de productos de red. Ej: FortiGate, Cisco Catalyst, MikroTik.';

INSERT INTO sch_system.tbl_cat_network_product (code, name, sort_order, estado_registro, estado)
VALUES
    ('CISCO',     'Cisco',              1, 'O', 'AI'),
    ('FORTINET',  'Fortinet',           2, 'O', 'AI'),
    ('PALOALTO',  'Palo Alto Networks', 3, 'O', 'AI'),
    ('JUNIPER',   'Juniper',            4, 'O', 'AI'),
    ('ARUBA',     'HPE Aruba',          5, 'O', 'AI'),
    ('MIKROTIK',  'MikroTik',           6, 'O', 'AI'),
    ('UBIQUITI',  'Ubiquiti',           7, 'O', 'AI'),
    ('OTRO_NET',  'Otro',               99, 'O', 'AI')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- tbl_network_devices — dispositivos de red (modelo plano, como tbl_servers)
-- ---------------------------------------------------------------------------
CREATE TABLE sch_system.tbl_network_devices (
    id                  SERIAL          PRIMARY KEY,
    code                VARCHAR(50)     NOT NULL UNIQUE,
    name                VARCHAR(200)    NOT NULL,
    host                VARCHAR(300)    NOT NULL,
    -- INTEGER con rango desde el principio: tbl_db_services.port nació SMALLINT
    -- y hubo que ampliarlo en la migración 014.
    port                INTEGER
                            CONSTRAINT chk_network_devices_port_range
                            CHECK (port IS NULL OR port BETWEEN 1 AND 65535),
    infrastructure_id   SMALLINT
                            REFERENCES sch_system.tbl_infrastructure(id),
    environment_id      SMALLINT        NOT NULL
                            REFERENCES sch_system.tbl_environment(id),
    product_id          SMALLINT
                            REFERENCES sch_system.tbl_cat_network_product(id),
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

COMMENT ON TABLE  sch_system.tbl_network_devices      IS 'Dispositivos de red (routers, switches, firewalls…). Un registro = un dispositivo en un ambiente.';
COMMENT ON COLUMN sch_system.tbl_network_devices.host IS 'IP o nombre por el que se administra el dispositivo.';
COMMENT ON COLUMN sch_system.tbl_network_devices.port IS 'Puerto de administración (1-65535). NULL = el habitual del protocolo (SSH 22, HTTPS 443…).';

CREATE INDEX idx_network_devices_environment_id
    ON sch_system.tbl_network_devices (environment_id);

CREATE INDEX idx_network_devices_infrastructure_id
    ON sch_system.tbl_network_devices (infrastructure_id)
    WHERE infrastructure_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- tbl_credentials — cuarta columna de recurso
-- ---------------------------------------------------------------------------
ALTER TABLE sch_secret.tbl_credentials
    ADD COLUMN network_device_id INT
        REFERENCES sch_system.tbl_network_devices(id);

COMMENT ON COLUMN sch_secret.tbl_credentials.network_device_id IS 'FK a tbl_network_devices. NOT NULL cuando resource_type=NET.';

ALTER TABLE sch_secret.tbl_credentials
    DROP CONSTRAINT chk_resource_xor,
    ADD  CONSTRAINT chk_resource_xor CHECK (
        (server_id         IS NOT NULL)::int +
        (db_service_id     IS NOT NULL)::int +
        (application_id    IS NOT NULL)::int +
        (network_device_id IS NOT NULL)::int = 1
    );

ALTER TABLE sch_secret.tbl_credentials
    DROP CONSTRAINT tbl_credentials_resource_type_check,
    ADD  CONSTRAINT tbl_credentials_resource_type_check
         CHECK (resource_type IN ('DB', 'OS', 'APP', 'NET'));

COMMENT ON COLUMN sch_secret.tbl_credentials.resource_type IS 'Desnormalizado para RBAC sin JOINs. OS=servidor, DB=servicio de BD, APP=aplicación, NET=dispositivo de red.';

CREATE INDEX idx_cred_network_device_id
    ON sch_secret.tbl_credentials (network_device_id)
    WHERE network_device_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Tipos por equipo y auditoría
-- ---------------------------------------------------------------------------
ALTER TABLE sch_system.tbl_team_resource_types
    DROP CONSTRAINT tbl_team_resource_types_resource_type_check,
    ADD  CONSTRAINT tbl_team_resource_types_resource_type_check
         CHECK (resource_type IN ('DB', 'OS', 'APP', 'NET'));

COMMENT ON COLUMN sch_system.tbl_team_resource_types.resource_type IS 'DB = bases de datos, OS = servidores, APP = aplicaciones, NET = dispositivos de red.';

ALTER TABLE sch_audit.tbl_audit_log
    DROP CONSTRAINT tbl_audit_log_resource_type_check,
    ADD  CONSTRAINT tbl_audit_log_resource_type_check
         CHECK (resource_type IN ('DB', 'OS', 'APP', 'NET', 'SYS'));

ALTER TABLE sch_audit.tbl_audit_log_historico
    DROP CONSTRAINT tbl_audit_log_resource_type_check,
    ADD  CONSTRAINT tbl_audit_log_resource_type_check
         CHECK (resource_type IN ('DB', 'OS', 'APP', 'NET', 'SYS'));

-- ---------------------------------------------------------------------------
-- Equipo NETOPS. WHERE NOT EXISTS y no ON CONFLICT: el código es único solo
-- entre registros vivos (índice parcial), y un ADMIN pudo haberlo creado ya.
--
-- El tipo NET se asigna SOLO al equipo que crea esta sentencia (CTE). Si ya
-- existía un NETOPS creado a mano, se deja como está: darle NET aquí ampliaría
-- en silencio lo que sus miembros pueden descifrar. Un ADMIN se lo asigna desde
-- Catálogos si corresponde.
-- ---------------------------------------------------------------------------
WITH nuevo AS (
    INSERT INTO sch_system.tbl_teams (code, name, description, is_system, estado_registro, estado)
    SELECT 'NETOPS', 'Operadores de Red', 'Equipo con acceso a credenciales de dispositivos de red.', TRUE, 'O', 'AI'
    WHERE NOT EXISTS (
        SELECT 1 FROM sch_system.tbl_teams WHERE UPPER(code) = 'NETOPS' AND estado_registro = 'O'
    )
    RETURNING id
)
INSERT INTO sch_system.tbl_team_resource_types (team_id, resource_type)
SELECT id, 'NET' FROM nuevo;
