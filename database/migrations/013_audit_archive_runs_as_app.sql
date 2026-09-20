-- =============================================================================
-- 013_audit_archive_runs_as_app.sql
--
-- Corrige los textos que dejó 012_audit_archive_table.sql.
--
-- 012 se escribió asumiendo que el archivado lo ejecutaría un rol separado
-- (icm_audit_owner), con la auditoría convertida en solo-inserción para la
-- aplicación. Esa vía se descartó por decisión operativa: icm_user es el
-- propietario de la base de datos de la aplicación y ninguna tarea posterior
-- debe depender de otro usuario. El archivado pasa a ser un script del propio
-- backend, `npm run archive-audit`, que corre con las credenciales de siempre.
--
-- Consecuencia asumida y registrada en AUDITORIA_SEGURIDAD.md: icm_user
-- conserva DELETE, UPDATE y TRUNCATE sobre sch_audit.tbl_audit_log, de modo que
-- el log no es inmutable frente a algo que logre ejecutar SQL con las
-- credenciales de la aplicación.
--
-- No se edita 012: migrationRunner verifica el checksum de cada migración ya
-- aplicada y modificar el archivo abortaría el arranque con INTEGRIDAD VIOLADA.
-- =============================================================================

UPDATE sch_system.tbl_system_settings
SET description = 'Días que un evento permanece en el log de auditoría activo. '
                  'Al superarlos se traslada a la tabla histórica (no se elimina). '
                  'No ocurre solo: lo ejecuta el script de mantenimiento '
                  '`npm run archive-audit`, pensado para una tarea programada.',
    updated_at = NOW()
WHERE key = 'audit_retention_days';

COMMENT ON TABLE sch_audit.tbl_audit_log_historico IS
    'Eventos de auditoría trasladados desde tbl_audit_log al superar '
    'audit_retention_days. Lo llena backend/scripts/archive-audit.js '
    '(npm run archive-audit), que corre como icm_user igual que el resto de la '
    'aplicación.';
