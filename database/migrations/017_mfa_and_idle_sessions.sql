-- =============================================================================
-- 017_mfa_and_idle_sessions.sql
--
-- Segundo factor de autenticación (TOTP, RFC 6238: Aegis, Google Authenticator,
-- Microsoft Authenticator…) y caducidad de sesiones por inactividad: una
-- aplicación que custodia credenciales y se publica en internet no puede
-- depender solo de la contraseña, ni dejar abiertas durante horas las sesiones
-- de equipos desatendidos.
--
-- tbl_users:
--   mfa_secret_encrypted  secreto TOTP cifrado con la Master Key (pgp_sym_*),
--                         igual que las credenciales; la rotación lo re-cifra.
--                         Existe también durante la activación, antes de
--                         confirmar el primer código (mfa_enabled = FALSE).
--   mfa_last_step         último paso de 30 s aceptado: un código no se puede
--                         usar dos veces.
-- tbl_mfa_recovery_codes: códigos de un solo uso, solo su SHA-256.
-- tbl_sessions.last_activity_at: base de la caducidad por inactividad.
--
-- Ajustes nuevos (categoría security):
--   mfa_policy            none | admins | all. Se siembra 'all': al aplicar la
--                         migración, cada usuario deberá activar su segundo
--                         factor en su siguiente acceso.
--   session_idle_minutes  0 = sin caducidad por inactividad; 1–1440 minutos.
-- =============================================================================

ALTER TABLE sch_system.tbl_users
    ADD COLUMN mfa_secret_encrypted TEXT,
    ADD COLUMN mfa_enabled          BOOLEAN     NOT NULL DEFAULT FALSE,
    ADD COLUMN mfa_enabled_at       TIMESTAMPTZ,
    ADD COLUMN mfa_last_step        BIGINT      NOT NULL DEFAULT 0;

ALTER TABLE sch_system.tbl_users
    ADD CONSTRAINT chk_mfa_enabled_has_secret
    CHECK (mfa_enabled = FALSE OR mfa_secret_encrypted IS NOT NULL);

COMMENT ON COLUMN sch_system.tbl_users.mfa_secret_encrypted IS 'Secreto TOTP cifrado con la Master Key (pgp_sym_encrypt). NUNCA en claro.';
COMMENT ON COLUMN sch_system.tbl_users.mfa_last_step        IS 'Último paso TOTP (30 s) aceptado. Impide reutilizar un código.';

CREATE TABLE sch_system.tbl_mfa_recovery_codes (
    id          SERIAL       PRIMARY KEY,
    user_id     UUID         NOT NULL REFERENCES sch_system.tbl_users(id) ON DELETE CASCADE,
    code_hash   TEXT         NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE sch_system.tbl_mfa_recovery_codes IS 'Códigos de recuperación del segundo factor. Solo SHA-256; un solo uso.';

CREATE INDEX idx_mfa_recovery_codes_user
    ON sch_system.tbl_mfa_recovery_codes (user_id)
    WHERE used_at IS NULL;

ALTER TABLE sch_system.tbl_sessions
    ADD COLUMN last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

COMMENT ON COLUMN sch_system.tbl_sessions.last_activity_at IS 'Última petición autenticada. Base de session_idle_minutes.';

INSERT INTO sch_system.tbl_system_settings
    (key, value, type, category, label, description, is_public)
VALUES
    ('mfa_policy',
     'all',
     'string', 'security',
     'Segundo factor de autenticación obligatorio',
     'Quién debe usar un código TOTP (Aegis, Google Authenticator…) además de la contraseña. Quien esté obligado y no lo tenga activado solo podrá activarlo al entrar.',
     FALSE),

    ('session_idle_minutes',
     '30',
     'integer', 'security',
     'Cerrar sesión tras inactividad (minutos)',
     'Minutos sin ninguna petición tras los que la sesión se cierra, aunque no haya vencido su duración. 0 = desactivado. Máximo 1440.',
     FALSE)
ON CONFLICT (key) DO NOTHING;
