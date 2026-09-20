-- =============================================================================
-- 005_credentials_security.sql
-- Credenciales cifradas y configuración de master key.
-- Reside en sch_secret (separado de sch_system por diseño de seguridad).
-- NUNCA se almacena la contraseña en texto plano.
-- Depende de: 003_users_sessions_settings.sql, 004_resources.sql
-- =============================================================================

-- ---------------------------------------------------------------------------
-- tbl_credentials : credenciales cifradas (tabla central del sistema)
-- El cifrado ocurre EN BACKEND con pgcrypto antes del INSERT.
-- Exactamente UNO de server_id / db_service_id / application_id debe ser NOT NULL.
--
-- CUSTODIA EXCLUSIVA:
-- Una credencial custodiada SOLO puede ser descifrada por su custodio.
-- Ni ADMIN puede romper esta restricción.
-- ---------------------------------------------------------------------------
CREATE TABLE sch_secret.tbl_credentials (
    id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Exactamente UNO de los tres debe ser NOT NULL (XOR enforced por constraint).
    server_id           INT         REFERENCES sch_system.tbl_servers(id),
    db_service_id       INT         REFERENCES sch_system.tbl_db_services(id),
    application_id      INT         REFERENCES sch_system.tbl_applications(id),

    CONSTRAINT chk_resource_xor CHECK (
        (server_id      IS NOT NULL)::int +
        (db_service_id  IS NOT NULL)::int +
        (application_id IS NOT NULL)::int = 1
    ),

    -- resource_type desnormalizado para filtros RBAC eficientes sin JOINs.
    resource_type       VARCHAR(10) NOT NULL
                            CHECK (resource_type IN ('DB', 'OS', 'APP')),

    username            VARCHAR(200) NOT NULL,

    -- password_encrypted: resultado de pgp_sym_encrypt(plaintext, master_key)
    -- ejecutado en backend. NUNCA texto plano.
    password_encrypted  TEXT        NOT NULL,

    description         TEXT,
    notes               TEXT,

    is_custodied        BOOLEAN     NOT NULL DEFAULT FALSE,
    custodian_user_id   UUID
                            REFERENCES sch_system.tbl_users(id),
    custodian_since     TIMESTAMPTZ,

    CONSTRAINT chk_custodian_required CHECK (
        is_custodied = FALSE OR
        (is_custodied = TRUE AND custodian_user_id IS NOT NULL)
    ),

    estado_registro     CHAR(1)     NOT NULL DEFAULT 'O'
                            CHECK (estado_registro IN ('O','X')),
    estado              CHAR(2)     NOT NULL DEFAULT 'AI'
                            CHECK (estado IN ('AI','IN')),
    created_by          UUID
                            REFERENCES sch_system.tbl_users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  sch_secret.tbl_credentials                    IS 'Credenciales cifradas con pgcrypto/pgp_sym_encrypt. NUNCA texto plano. Acceso controlado por RBAC + equipo + custodia.';
COMMENT ON COLUMN sch_secret.tbl_credentials.password_encrypted IS 'Resultado de pgp_sym_encrypt(texto_plano, master_key) ejecutado en backend.';
COMMENT ON COLUMN sch_secret.tbl_credentials.resource_type      IS 'Desnormalizado para RBAC sin JOINs. OS=servidor, DB=servicio de BD, APP=aplicación.';
COMMENT ON COLUMN sch_secret.tbl_credentials.is_custodied       IS 'TRUE = solo el custodian_user_id puede ver la contraseña. Ni ADMIN puede forzar acceso.';
COMMENT ON COLUMN sch_secret.tbl_credentials.server_id          IS 'FK a tbl_servers. NOT NULL cuando resource_type=OS.';
COMMENT ON COLUMN sch_secret.tbl_credentials.db_service_id      IS 'FK a tbl_db_services. NOT NULL cuando resource_type=DB.';
COMMENT ON COLUMN sch_secret.tbl_credentials.application_id     IS 'FK a tbl_applications. NOT NULL cuando resource_type=APP.';

-- Índices de credenciales (partial: solo registros activos)
CREATE INDEX idx_cred_server_id
    ON sch_secret.tbl_credentials (server_id)
    WHERE server_id IS NOT NULL;

CREATE INDEX idx_cred_db_service_id
    ON sch_secret.tbl_credentials (db_service_id)
    WHERE db_service_id IS NOT NULL;

CREATE INDEX idx_cred_application_id
    ON sch_secret.tbl_credentials (application_id)
    WHERE application_id IS NOT NULL;

CREATE INDEX idx_cred_resource_type
    ON sch_secret.tbl_credentials (resource_type)
    WHERE estado_registro = 'O';

CREATE INDEX idx_cred_custodian
    ON sch_secret.tbl_credentials (custodian_user_id)
    WHERE is_custodied = TRUE AND estado_registro = 'O';

-- ---------------------------------------------------------------------------
-- tbl_master_config : registro histórico de Master Keys
-- SOLO almacena hash SHA-256. NUNCA la clave en texto plano.
-- Preparado para futura integración con KMS externo (GCP/AWS/Azure).
-- ---------------------------------------------------------------------------
CREATE TABLE sch_secret.tbl_master_config (
    id                      SMALLSERIAL     PRIMARY KEY,
    key_alias               VARCHAR(100)    NOT NULL UNIQUE,
    key_hash                TEXT            NOT NULL,
    kms_provider            VARCHAR(20)     NOT NULL DEFAULT 'LOCAL'
                                CHECK (kms_provider IN ('LOCAL','GCP','AWS','AZURE')),
    kms_key_ref             TEXT,
    is_active               BOOLEAN         NOT NULL DEFAULT TRUE,
    credentials_recrypted   INT             DEFAULT 0,
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    rotated_at              TIMESTAMPTZ,
    rotated_by              UUID
                                REFERENCES sch_system.tbl_users(id)
);

COMMENT ON TABLE  sch_secret.tbl_master_config                       IS 'Historial de Master Keys. SOLO hashes SHA-256. NUNCA la clave real.';
COMMENT ON COLUMN sch_secret.tbl_master_config.key_hash              IS 'SHA-256 hex del master key. Para verificar que la key en .env coincide.';
COMMENT ON COLUMN sch_secret.tbl_master_config.is_active             IS 'Solo un registro TRUE simultáneamente. Al rotar: nueva entrada TRUE, anterior FALSE.';
COMMENT ON COLUMN sch_secret.tbl_master_config.credentials_recrypted IS 'Cantidad de credenciales re-cifradas en la rotación. 0 en la entrada inicial.';
COMMENT ON COLUMN sch_secret.tbl_master_config.kms_key_ref           IS 'Referencia al recurso KMS externo. Vacío en modo LOCAL.';
