-- =============================================================================
-- 018_ldap_auth.sql
--
-- Autenticación contra Active Directory / LDAP para los usuarios que el ADMIN
-- dé de alta como tales. Nadie se crea solo al iniciar sesión: el alta, el rol y
-- el equipo siguen siendo cosa del ADMIN, y el directorio solo comprueba la
-- contraseña (backend/src/services/directory.service.js).
--
-- tbl_users.auth_source:
--   LOCAL  contraseña propia de ICM (bcrypt en password_hash). Todos los
--          usuarios existentes quedan así: el comportamiento no cambia.
--   LDAP   contraseña de dominio. password_hash queda NULL: ICM no la guarda,
--          no la cambia ni la resetea.
--
-- Ajustes nuevos:
--   ldap_enabled (security)  se siembra 'false'. Con LDAP desactivado, los
--                            usuarios LDAP no pueden entrar y los locales siguen
--                            igual. Se cambia como cualquier otro ajuste.
--   ldap_* (categoría nueva 'ldap')  conexión con el directorio: servidor,
--                            formato del usuario, TLS y tiempo máximo. Quien
--                            controla la URL recibe las contraseñas de dominio,
--                            así que NO se editan por el PUT genérico de ajustes:
--                            solo por PUT /api/system/ldap, que exige contraseña
--                            y segundo factor del ADMIN y queda auditado.
-- =============================================================================

ALTER TABLE sch_system.tbl_users
    ADD COLUMN auth_source VARCHAR(10) NOT NULL DEFAULT 'LOCAL';

ALTER TABLE sch_system.tbl_users
    ADD CONSTRAINT chk_users_auth_source CHECK (auth_source IN ('LOCAL', 'LDAP'));

ALTER TABLE sch_system.tbl_users
    ALTER COLUMN password_hash DROP NOT NULL;

-- Un usuario local sin hash no podría entrar nunca: se impide en la base.
ALTER TABLE sch_system.tbl_users
    ADD CONSTRAINT chk_users_local_has_password
    CHECK (auth_source <> 'LOCAL' OR password_hash IS NOT NULL);

COMMENT ON COLUMN sch_system.tbl_users.auth_source   IS 'LOCAL: contraseña de ICM (bcrypt). LDAP: contraseña de dominio, verificada con un bind; sin hash en BD.';
COMMENT ON COLUMN sch_system.tbl_users.password_hash IS 'bcrypt hash factor 14. NUNCA texto plano. NULL en usuarios LDAP.';

ALTER TABLE sch_system.tbl_system_settings
    DROP CONSTRAINT tbl_system_settings_category_check;

ALTER TABLE sch_system.tbl_system_settings
    ADD CONSTRAINT tbl_system_settings_category_check
    CHECK (category IN ('general', 'security', 'notifications', 'ldap'));

INSERT INTO sch_system.tbl_system_settings
    (key, value, type, category, label, description, is_public)
VALUES
    ('ldap_enabled',
     'false',
     'boolean', 'security',
     'Autenticación con Active Directory / LDAP',
     'Permite entrar a los usuarios dados de alta con origen LDAP, usando su contraseña de dominio. La conexión se configura en la tarjeta Directorio. Desactivado, los usuarios LDAP no pueden entrar; los locales no se ven afectados.',
     FALSE),

    ('ldap_url', '', 'string', 'ldap',
     'Servidor LDAP',
     'ldap://servidor[:389] o ldaps://servidor[:636].', FALSE),

    ('ldap_bind_template', '', 'string', 'ldap',
     'Formato del usuario',
     'Cómo se forma el usuario del bind. {username} es el username de ICM: DOMINIO\{username}, {username}@dominio.local o un DN.', FALSE),

    ('ldap_starttls', 'false', 'boolean', 'ldap',
     'Usar StartTLS',
     'Cifra una conexión ldap:// si el servidor lo admite. No aplica a ldaps://.', FALSE),

    ('ldap_tls_verify', 'true', 'boolean', 'ldap',
     'Validar el certificado del servidor',
     'Con LDAPS o StartTLS. Desactivarlo expone a que otro servidor se haga pasar por el directorio.', FALSE),

    ('ldap_tls_ca', '', 'string', 'ldap',
     'Certificado de la CA (PEM)',
     'CA interna que firmó el certificado del controlador de dominio. Vacío: las CA del sistema.', FALSE),

    ('ldap_timeout_ms', '5000', 'integer', 'ldap',
     'Tiempo máximo de conexión (ms)',
     'Entre 1000 y 60000.', FALSE)
ON CONFLICT (key) DO NOTHING;
