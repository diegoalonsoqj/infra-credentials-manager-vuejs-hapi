-- =============================================================================
-- 014_db_service_port_integer.sql
--
-- Amplía tbl_db_services.port de SMALLINT a INTEGER y acota su rango.
--
-- 004 declaró el puerto como SMALLINT, cuyo máximo es 32767. Un puerto TCP
-- llega hasta 65535, y hay valores legítimos por encima del límite: DB2 escucha
-- por defecto en el 50000, y los puertos altos son habituales en instancias
-- con nombre o detrás de un balanceador. Guardar uno de ellos fallaba con
-- 22003 (valor fuera de rango), que la API traducía a un 500 genérico. Al
-- mismo tiempo SMALLINT admitía 0 y negativos, que no son puertos.
--
-- El formulario ya ofrecía el rango 1-65535 (DbServiceForm.vue); ahora la
-- columna y la validación de la ruta (resources.routes.js) dicen lo mismo.
--
-- Cambiar de SMALLINT a INTEGER es una ampliación: todos los valores existentes
-- caben, así que el ALTER no puede perder datos. La restricción se añade
-- después; si una fila tuviera un puerto 0 o negativo, la migración fallaría
-- entera y no dejaría nada a medias.
-- =============================================================================

ALTER TABLE sch_system.tbl_db_services
    ALTER COLUMN port TYPE INTEGER;

ALTER TABLE sch_system.tbl_db_services
    ADD CONSTRAINT chk_db_services_port_range
    CHECK (port IS NULL OR port BETWEEN 1 AND 65535);

COMMENT ON COLUMN sch_system.tbl_db_services.port IS
    'Puerto TCP del servicio (1-65535). NULL si no aplica o se usa el del motor.';
