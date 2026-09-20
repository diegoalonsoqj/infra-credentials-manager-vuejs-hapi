-- =============================================================================
-- 003_users_sessions_settings.sql
-- Usuarios, sesiones y configuración del sistema.
-- Depende de: 002_catalogs.sql (tbl_roles, tbl_teams)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- tbl_users : usuarios del sistema
-- first_name / last_name permiten mostrar nombre corto correcto en la UI.
-- full_name se mantiene como campo de nombre completo.
-- ---------------------------------------------------------------------------
CREATE TABLE sch_system.tbl_users (
    id                  UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    username            VARCHAR(50)     NOT NULL UNIQUE,
    email               VARCHAR(150)    NOT NULL UNIQUE,
    full_name           VARCHAR(200)    NOT NULL,
    first_name          VARCHAR(80)     NOT NULL DEFAULT '',
    last_name           VARCHAR(80)     NOT NULL DEFAULT '',
    password_hash       TEXT            NOT NULL,
    role_id             SMALLINT        NOT NULL
                            REFERENCES sch_system.tbl_roles(id),
    team_id             SMALLINT
                            REFERENCES sch_system.tbl_teams(id),
    force_pwd_change    BOOLEAN         NOT NULL DEFAULT TRUE,
    last_login_at       TIMESTAMPTZ,
    failed_attempts     SMALLINT        NOT NULL DEFAULT 0,
    locked_until        TIMESTAMPTZ,
    estado_registro     CHAR(1)         NOT NULL DEFAULT 'O'
                            CHECK (estado_registro IN ('O','X')),
    estado              CHAR(2)         NOT NULL DEFAULT 'AI'
                            CHECK (estado IN ('AI','IN')),
    created_by          UUID
                            REFERENCES sch_system.tbl_users(id),
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  sch_system.tbl_users                  IS 'Usuarios del sistema. Soft-delete via estado_registro. Bloqueo temporal via locked_until.';
COMMENT ON COLUMN sch_system.tbl_users.team_id          IS 'NULL para roles ADMIN y VISITOR. DBA y SYSADMIN requieren equipo asignado.';
COMMENT ON COLUMN sch_system.tbl_users.password_hash    IS 'bcrypt hash factor 14. NUNCA texto plano.';
COMMENT ON COLUMN sch_system.tbl_users.force_pwd_change IS 'TRUE = el usuario debe cambiar contraseña en el próximo login.';
COMMENT ON COLUMN sch_system.tbl_users.failed_attempts  IS 'Contador de intentos fallidos de login. Se resetea en login exitoso.';
COMMENT ON COLUMN sch_system.tbl_users.locked_until     IS 'Si NOT NULL y > NOW(), el usuario está bloqueado temporalmente.';
COMMENT ON COLUMN sch_system.tbl_users.first_name       IS 'Primer nombre del usuario.';
COMMENT ON COLUMN sch_system.tbl_users.last_name        IS 'Primer apellido del usuario.';

-- Índices de usuarios
-- Unique parcial: permite reutilizar username/email de usuarios eliminados lógicamente.
CREATE UNIQUE INDEX idx_users_username_active
    ON sch_system.tbl_users (username)
    WHERE estado_registro = 'O';

CREATE UNIQUE INDEX idx_users_email_active
    ON sch_system.tbl_users (email)
    WHERE estado_registro = 'O';

CREATE INDEX idx_users_role_id
    ON sch_system.tbl_users (role_id);

CREATE INDEX idx_users_team_id
    ON sch_system.tbl_users (team_id)
    WHERE team_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- tbl_sessions : sesiones JWT activas
-- token_hash = SHA-256 del JWT. Nunca el token en texto plano.
-- Inmutables: solo se revocan (revoked=TRUE).
-- ---------------------------------------------------------------------------
CREATE TABLE sch_system.tbl_sessions (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID        NOT NULL
                    REFERENCES sch_system.tbl_users(id),
    token_hash  TEXT        NOT NULL UNIQUE,
    ip_address  INET,
    user_agent  TEXT,
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked     BOOLEAN     NOT NULL DEFAULT FALSE,
    revoked_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  sch_system.tbl_sessions            IS 'Sesiones JWT activas. Inmutables: solo se marcan como revoked=TRUE.';
COMMENT ON COLUMN sch_system.tbl_sessions.token_hash IS 'SHA-256 hex del JWT. NUNCA el token completo en BD.';
COMMENT ON COLUMN sch_system.tbl_sessions.revoked    IS 'TRUE = sesión invalidada. El middleware de auth rechaza tokens revocados.';

-- Índices de sesiones (partial: solo sesiones activas en el hot path)
CREATE INDEX idx_sessions_user_active
    ON sch_system.tbl_sessions (user_id, expires_at)
    WHERE revoked = FALSE;

CREATE INDEX idx_sessions_token_active
    ON sch_system.tbl_sessions (token_hash)
    WHERE revoked = FALSE;

-- ---------------------------------------------------------------------------
-- tbl_system_settings : configuración del sistema (key-value tipado)
-- Modificable por ADMIN en tiempo de ejecución sin reiniciar el servidor.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sch_system.tbl_system_settings (
    key         VARCHAR(50)  PRIMARY KEY,
    value       TEXT         NOT NULL,
    type        VARCHAR(10)  NOT NULL CHECK (type IN ('string', 'integer', 'boolean', 'email')),
    category    VARCHAR(20)  NOT NULL CHECK (category IN ('general', 'security', 'notifications')),
    label       VARCHAR(100) NOT NULL,
    description TEXT,
    is_public   BOOLEAN      NOT NULL DEFAULT FALSE,
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_by  UUID         REFERENCES sch_system.tbl_users(id) ON DELETE SET NULL
);

COMMENT ON TABLE  sch_system.tbl_system_settings           IS 'Parámetros de configuración del sistema. Modificables por ADMIN en tiempo de ejecución.';
COMMENT ON COLUMN sch_system.tbl_system_settings.is_public IS 'Si TRUE, el endpoint /api/system/settings/public lo expone sin autenticación.';

INSERT INTO sch_system.tbl_system_settings
    (key, value, type, category, label, description, is_public)
VALUES
    ('app_name',
     'ICM — Gestión de Credenciales',
     'string', 'general',
     'Nombre de la aplicación',
     'Nombre que aparece en el encabezado y en el título del navegador.',
     TRUE),

    ('timezone',
     'America/Lima',
     'string', 'general',
     'Zona horaria del sistema',
     'Zona horaria IANA (ej. America/Lima). Se usa para mostrar fechas y horas en toda la interfaz.',
     TRUE),

    ('locale',
     'es-PE',
     'string', 'general',
     'Configuración regional (locale)',
     'Código BCP-47 para formato de fechas y números (ej. es-PE, en-US).',
     TRUE),

    ('session_ttl_minutes',
     '480',
     'integer', 'security',
     'Duración de sesión (minutos)',
     'Tiempo máximo de una sesión activa. Pasado este tiempo el token expira automáticamente.',
     FALSE),

    ('session_max_concurrent',
     '3',
     'integer', 'security',
     'Sesiones concurrentes máximas por usuario',
     'Si se supera este límite al iniciar sesión, la sesión más antigua se revoca automáticamente.',
     FALSE),

    ('password_min_length',
     '10',
     'integer', 'security',
     'Longitud mínima de contraseña de usuario',
     'Número mínimo de caracteres requeridos al crear o cambiar contraseñas de usuarios.',
     FALSE),

    ('allow_visitor_access',
     'true',
     'boolean', 'security',
     'Permitir acceso a visitantes',
     'Si está desactivado, los usuarios con rol VISITOR no podrán iniciar sesión.',
     FALSE),

    ('audit_retention_days',
     '365',
     'integer', 'security',
     'Retención de auditoría (días)',
     'Número de días que se conservan los registros de auditoría.',
     FALSE),

    ('decrypt_timeout_secs',
     '30',
     'integer', 'security',
     'Tiempo visible modal de contraseña (segundos)',
     'Segundos que permanece abierto el modal de descifrado antes de cerrarse automáticamente.',
     TRUE)

ON CONFLICT (key) DO NOTHING;
