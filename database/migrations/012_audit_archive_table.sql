-- =============================================================================
-- 012_audit_archive_table.sql
--
-- Crea el destino del archivado de auditoría y corrige la etiqueta del ajuste
-- audit_retention_days, que hasta ahora prometía algo que no ocurría.
--
-- -----------------------------------------------------------------------------
-- EL PROBLEMA QUE RESUELVE
-- -----------------------------------------------------------------------------
-- El panel mostraba "Retención de auditoría (días): 365" y NADIE leía ese valor:
-- la cadena 'audit_retention_days' no aparecía una sola vez en el backend. No se
-- borraba ni se movía ninguna fila jamás, así que el registro de hace dos años
-- seguía en la tabla principal. Quien leyera esa pantalla concluiría lo
-- contrario.
--
-- -----------------------------------------------------------------------------
-- POR QUÉ ARCHIVAR Y NO BORRAR
-- -----------------------------------------------------------------------------
-- En un gestor de credenciales, el rastro de quién descifró qué es la única
-- prueba de lo que ha pasado. Borrarlo a los N días destruye la respuesta a
-- "¿quién sacó la contraseña de producción en marzo?". Se traslada a una tabla
-- histórica: la principal queda acotada a la ventana de retención (consultas
-- rápidas y expectativa cumplida) y el rastro completo se conserva.
--
-- ATENCIÓN: archivar NO es eliminar. Las filas siguen en la misma base de datos,
-- con los mismos usuarios e IPs. Si alguna vez hay una obligación de SUPRIMIR
-- datos personales pasado un plazo, esto no la cumple: haría falta un borrado
-- real o una exportación fuera del sistema.
--
-- -----------------------------------------------------------------------------
-- QUIÉN MUEVE LAS FILAS
-- -----------------------------------------------------------------------------
-- La aplicación NO. El traslado exige DELETE sobre tbl_audit_log, y el objetivo
-- del endurecimiento (database/hardening/01_audit_append_only.sql) es justo
-- quitarle ese privilegio a icm_user, para que una inyección SQL o un
-- compromiso del proceso no puedan borrar el rastro.
--
-- Lo ejecuta el rol icm_audit_owner con database/hardening/02_audit_archive.sql,
-- que además LEE audit_retention_days de tbl_system_settings: así el número del
-- panel es el que manda de verdad, aunque el ejecutor viva fuera de la app.
--
-- ORDEN DE APLICACIÓN: esta migración ANTES que 01_audit_append_only.sql.
-- Después de aquel script, icm_user deja de ser dueño de sch_audit y
-- migrationRunner ya no podrá crear objetos ahí.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Tabla histórica: misma forma que la principal.
--
-- LIKE ... INCLUDING CONSTRAINTS copia columnas, tipos y CHECKs, de modo que
-- las dos tablas no pueden divergir por olvido al añadir una columna aquí.
-- Se excluyen los DEFAULTS a propósito: el de `id` es nextval() sobre la
-- secuencia de la tabla principal, y el histórico recibe los id ya asignados.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sch_audit.tbl_audit_log_historico (
    LIKE sch_audit.tbl_audit_log INCLUDING CONSTRAINTS
);

-- Momento del traslado, para distinguirlo de created_at (el del evento).
ALTER TABLE sch_audit.tbl_audit_log_historico
    ADD COLUMN IF NOT EXISTS archived_at timestamptz NOT NULL DEFAULT NOW();

-- El id sigue siendo único: procede de la secuencia de la tabla principal y
-- garantiza que un traslado repetido no duplique filas (ON CONFLICT DO NOTHING).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'tbl_audit_log_historico_pkey'
    ) THEN
        ALTER TABLE sch_audit.tbl_audit_log_historico
            ADD CONSTRAINT tbl_audit_log_historico_pkey PRIMARY KEY (id);
    END IF;
END
$$;

-- El histórico se consulta por fecha en investigaciones puntuales. Un solo
-- índice: no merece la pena replicar los cinco de la tabla caliente.
CREATE INDEX IF NOT EXISTS idx_audit_hist_time
    ON sch_audit.tbl_audit_log_historico (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_hist_user_time
    ON sch_audit.tbl_audit_log_historico (user_id, created_at DESC)
    WHERE user_id IS NOT NULL;

COMMENT ON TABLE sch_audit.tbl_audit_log_historico IS
    'Eventos de auditoría trasladados desde tbl_audit_log al superar audit_retention_days. '
    'Lo llena database/hardening/02_audit_archive.sql, ejecutado por icm_audit_owner. '
    'La aplicación solo tiene SELECT sobre esta tabla.';

-- ---------------------------------------------------------------------------
-- La etiqueta deja de mentir.
--
-- Antes: "Retención de auditoría (días)" / "Número de días que se conservan los
-- registros de auditoría." — lo que hacía creer que pasado ese plazo se
-- eliminaban solos.
-- ---------------------------------------------------------------------------
UPDATE sch_system.tbl_system_settings
SET label = 'Retención en el log principal (días)',
    description = 'Días que un evento permanece en el log de auditoría activo. '
                  'Al superarlos se traslada al histórico (no se elimina) mediante '
                  'la tarea de mantenimiento que ejecuta el DBA. No se aplica solo: '
                  'la aplicación no tiene permiso para borrar auditoría.',
    updated_at = NOW()
WHERE key = 'audit_retention_days';
