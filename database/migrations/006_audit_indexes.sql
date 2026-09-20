-- =============================================================================
-- 006_audit_indexes.sql
-- Log de auditoría inmutable + índices de rendimiento generales.
-- INMUTABLE: ningún endpoint ni rol puede modificar o eliminar registros.
-- Sin FK a tbl_users: preserva historia aunque el usuario sea eliminado.
-- Depende de: todas las migraciones anteriores.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- tbl_audit_log : log de auditoría del sistema
-- ---------------------------------------------------------------------------
CREATE TABLE sch_audit.tbl_audit_log (
    id                  BIGSERIAL       PRIMARY KEY,

    -- NULL si la acción es del sistema (ej: SETUP_COMPLETED).
    -- Sin FK a tbl_users para preservar historial aunque el usuario sea eliminado.
    user_id             UUID,
    username            VARCHAR(50),

    action              VARCHAR(100)    NOT NULL,

    -- Tipo de recurso afectado.
    resource_type       CHAR(3)
                            CHECK (resource_type IN ('DB','OS','SYS')),

    resource_id         TEXT,
    resource_name       TEXT,

    -- Desnormalizados para filtros directos sin JOINs.
    environment_code    VARCHAR(10),
    infrastructure_code VARCHAR(20),

    ip_address          INET,
    user_agent          TEXT,

    result              CHAR(1)         NOT NULL
                            CHECK (result IN ('S','F')),
    fail_reason         TEXT,

    extra_data          JSONB           NOT NULL DEFAULT '{}',

    -- Flags para dashboards de seguridad y alertas.
    is_custodied_access BOOLEAN         NOT NULL DEFAULT FALSE,
    is_prd_access       BOOLEAN         NOT NULL DEFAULT FALSE,

    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
    -- SIN updated_at: inmutable por diseño.
    -- SIN estado_registro: nunca se elimina ni desactiva.
);

COMMENT ON TABLE  sch_audit.tbl_audit_log                     IS 'Log de auditoría INMUTABLE. Ningún rol puede modificar ni borrar registros, incluido ADMIN.';
COMMENT ON COLUMN sch_audit.tbl_audit_log.user_id             IS 'NULL para acciones del sistema. Sin FK a tbl_users para preservar historia.';
COMMENT ON COLUMN sch_audit.tbl_audit_log.username            IS 'Desnormalizado. Refleja el username al momento de la acción.';
COMMENT ON COLUMN sch_audit.tbl_audit_log.result              IS 'S=éxito, F=fallo. Todo intento se registra, exitoso o no.';
COMMENT ON COLUMN sch_audit.tbl_audit_log.is_custodied_access IS 'TRUE = el acceso involucró una credencial custodiada.';
COMMENT ON COLUMN sch_audit.tbl_audit_log.is_prd_access       IS 'TRUE = el acceso fue sobre ambiente PRD. Activa alertas de seguridad.';

-- Índices de auditoría (DESC en created_at: dashboards piden lo más reciente primero)
CREATE INDEX idx_audit_user_time
    ON sch_audit.tbl_audit_log (user_id, created_at DESC)
    WHERE user_id IS NOT NULL;

CREATE INDEX idx_audit_action_time
    ON sch_audit.tbl_audit_log (action, created_at DESC);

CREATE INDEX idx_audit_result_time
    ON sch_audit.tbl_audit_log (result, created_at DESC);

CREATE INDEX idx_audit_prd
    ON sch_audit.tbl_audit_log (created_at DESC)
    WHERE is_prd_access = TRUE;

CREATE INDEX idx_audit_custodied
    ON sch_audit.tbl_audit_log (created_at DESC)
    WHERE is_custodied_access = TRUE;
