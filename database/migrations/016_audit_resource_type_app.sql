-- =============================================================================
-- 016_audit_resource_type_app.sql
--
-- La auditoría no admitía el tipo de recurso APP.
--
-- 006 creó tbl_audit_log con CHECK (resource_type IN ('DB','OS','SYS')), y 012
-- copió esa restricción al histórico. Las credenciales de aplicación (APP, ya en
-- 002 y 005) se añadieron sin ampliarla, así que todo INSERT en la auditoría de
-- una credencial APP violaba el CHECK (23514):
--   - descifrarla respondía siempre 500: su auditoría es obligatoria y, si no
--     se escribe, la operación se cancela;
--   - el resto de eventos (alta, ver, editar, borrar, custodia) se auditaba
--     "best effort" y el error se descartaba: no quedaba rastro.
-- Lo destapó una rotación de Master Key, al descifrar credenciales APP por la
-- API.
--
-- CHAR(3) ya admite 'APP'. Solo se amplía el CHECK; ninguna fila cambia.
-- =============================================================================

ALTER TABLE sch_audit.tbl_audit_log
    DROP CONSTRAINT tbl_audit_log_resource_type_check,
    ADD  CONSTRAINT tbl_audit_log_resource_type_check
         CHECK (resource_type IN ('DB', 'OS', 'APP', 'SYS'));

ALTER TABLE sch_audit.tbl_audit_log_historico
    DROP CONSTRAINT tbl_audit_log_resource_type_check,
    ADD  CONSTRAINT tbl_audit_log_resource_type_check
         CHECK (resource_type IN ('DB', 'OS', 'APP', 'SYS'));
