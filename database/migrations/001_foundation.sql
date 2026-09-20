-- =============================================================================
-- 001_foundation.sql
-- Extensiones, schemas y tabla de control de migraciones.
-- DEBE ejecutarse primero. Sin dependencias externas.
-- =============================================================================

-- Extensiones requeridas
CREATE EXTENSION IF NOT EXISTS pgcrypto;     -- cifrado reversible AES (pgp_sym_*)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; -- generación de UUIDs

-- Schemas de separación lógica:
--   sch_system : tablas operativas y de negocio
--   sch_secret : tablas con datos cifrados (credenciales y master config)
--   sch_audit  : log de auditoría inmutable
CREATE SCHEMA IF NOT EXISTS sch_system;
CREATE SCHEMA IF NOT EXISTS sch_secret;
CREATE SCHEMA IF NOT EXISTS sch_audit;

-- Tabla de control de migraciones aplicadas.
-- Permite idempotencia: no re-ejecutar migraciones ya aplicadas.
-- checksum SHA-256 detecta modificaciones post-aplicación (integridad).
CREATE TABLE IF NOT EXISTS sch_system.tbl_migrations (
    id          SERIAL          PRIMARY KEY,
    filename    VARCHAR(255)    NOT NULL UNIQUE,
    checksum    VARCHAR(64)     NOT NULL,
    applied_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  sch_system.tbl_migrations          IS 'Control de migraciones SQL aplicadas. Inmutable una vez registrada.';
COMMENT ON COLUMN sch_system.tbl_migrations.checksum IS 'SHA-256 hex del contenido del archivo. Detecta modificaciones posteriores.';
