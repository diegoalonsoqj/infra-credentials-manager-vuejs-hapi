-- =============================================================================
-- 009_fix_custody_column_comments.sql
--
-- Corrige el comentario de is_custodied, que afirmaba "Ni ADMIN puede forzar
-- acceso". No es exacto: la custodia impide que
-- un ADMIN descifre directamente una credencial custodiada por otro, pero ese
-- mismo ADMIN puede reasignarse la custodia con
-- PATCH /api/credentials/:id/custodian y descifrar a continuación.
--
-- Esa vía existe a propósito —es la salida de emergencia cuando el custodio
-- deja la organización— y queda registrada en auditoría como CUSTODIAN_REASSIGN
-- con selfAssigned=true. La garantía real es, por tanto, la trazabilidad y no
-- la imposibilidad, y el comentario debe decirlo para no dar una falsa
-- sensación de seguridad a quien inspeccione el esquema.
--
-- Se corrige en una migración nueva y no editando 005_credentials_security.sql
-- porque migrationRunner compara el checksum de cada migración ya aplicada:
-- modificar el archivo original abortaría con INTEGRIDAD VIOLADA.
-- =============================================================================

COMMENT ON COLUMN sch_secret.tbl_credentials.is_custodied IS
    'TRUE = solo el custodian_user_id puede descifrar, editar, desactivar o eliminar la credencial; la restricción se aplica también a ADMIN. Un ADMIN sí puede reasignarse la custodia (PATCH /api/credentials/:id/custodian) y descifrar después: queda auditado como CUSTODIAN_REASSIGN con selfAssigned=true. La garantía es la trazabilidad, no la imposibilidad.';

COMMENT ON COLUMN sch_secret.tbl_credentials.custodian_user_id IS
    'Usuario que custodia la credencial. Obligatorio cuando is_custodied = TRUE (ver chk_custodian_required). Debe existir y estar activo: lo validan tanto la creación como la reasignación.';
