-- =============================================================================
-- 010_seed_cat_catalogs.sql
--
-- Carga los valores base de los cuatro catálogos que 002_catalogs.sql creó
-- vacíos: tbl_cat_os, tbl_cat_server_product, tbl_cat_db_product y
-- tbl_cat_db_engine.
--
-- En 002 cada tabla lleva su INSERT inmediatamente después del CREATE TABLE
-- (tbl_environment, tbl_infrastructure, tbl_roles, tbl_teams, tbl_permissions,
-- tbl_role_permissions). El patrón se rompe justo en las últimas tablas del
-- archivo: se crean y nadie las llena. Los seeds tampoco las cubren, así que
-- las pestañas "SO", "Producto servidor", "Producto BD" y "Motor BD" de la
-- página de Catálogos salen vacías tras una instalación limpia, y los
-- formularios de servidores y servicios de BD no ofrecen dónde elegir (os_id,
-- product_id y db_engine_id son nullable en 004_resources.sql, de modo que los
-- registros se crean sin esos datos y nada avisa).
--
-- Se corrige en una migración nueva y no editando 002_catalogs.sql porque
-- migrationRunner compara el checksum de cada migración ya aplicada: modificar
-- el archivo original abortaría con INTEGRIDAD VIOLADA.
--
-- Los valores siguen los ejemplos que el propio esquema documenta en los
-- COMMENT ON TABLE de 002 y cubren las cuatro infraestructuras sembradas
-- (ONPREM, GCP, AWS, AZURE). Son un punto de partida editable: los cuatro
-- catálogos tienen CRUD completo en /admin/catalogs, así que cada instalación
-- añade o desactiva lo que le sobre sin tocar SQL.
--
-- Idempotente: ON CONFLICT (code) DO NOTHING en las cuatro tablas, para que
-- reaplicarla sobre una base que ya tenga valores propios no duplique ni falle.
--
-- tbl_cat_project queda a propósito vacía: sus filas son los proyectos GCP,
-- clusters de VMware o unidades lógicas concretas de cada organización y no
-- existe un conjunto base que sembrar.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- tbl_cat_os — familias de sistema operativo
-- Granularidad según el COMMENT de 002 ("Ej: Linux, Windows, Unix"): la
-- familia, no la distribución ni la versión.
-- ---------------------------------------------------------------------------
INSERT INTO sch_system.tbl_cat_os (code, name, sort_order, estado_registro, estado)
VALUES
    ('LINUX',   'Linux',   1, 'O', 'AI'),
    ('WINDOWS', 'Windows', 2, 'O', 'AI'),
    ('UNIX',    'Unix',    3, 'O', 'AI')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- tbl_cat_server_product — plataforma sobre la que corre el servidor
-- ---------------------------------------------------------------------------
INSERT INTO sch_system.tbl_cat_server_product (code, name, sort_order, estado_registro, estado)
VALUES
    ('PHYSICAL',  'Servidor físico',          1, 'O', 'AI'),
    ('VMWARE',    'VMware vSphere VM',        2, 'O', 'AI'),
    ('GCE',       'Google Compute Engine',    3, 'O', 'AI'),
    ('EC2',       'Amazon EC2',               4, 'O', 'AI'),
    ('AZURE_VM',  'Azure Virtual Machine',    5, 'O', 'AI')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- tbl_cat_db_product — servicio bajo el que se ofrece la base de datos
-- Es el "quién la opera" (gestionada por un proveedor o self-hosted), distinto
-- del motor, que va en tbl_cat_db_engine.
-- ---------------------------------------------------------------------------
INSERT INTO sch_system.tbl_cat_db_product (code, name, sort_order, estado_registro, estado)
VALUES
    ('SELF_HOSTED', 'Self-hosted',          1, 'O', 'AI'),
    ('CLOUD_SQL',   'Google Cloud SQL',     2, 'O', 'AI'),
    ('ALLOYDB',     'Google AlloyDB',       3, 'O', 'AI'),
    ('RDS',         'Amazon RDS',           4, 'O', 'AI'),
    ('AURORA',      'Amazon Aurora',        5, 'O', 'AI'),
    ('AZURE_SQL',   'Azure SQL Database',   6, 'O', 'AI')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- tbl_cat_db_engine — motor de base de datos
-- ---------------------------------------------------------------------------
INSERT INTO sch_system.tbl_cat_db_engine (code, name, sort_order, estado_registro, estado)
VALUES
    ('POSTGRESQL', 'PostgreSQL',           1, 'O', 'AI'),
    ('MYSQL',      'MySQL',                2, 'O', 'AI'),
    ('MARIADB',    'MariaDB',              3, 'O', 'AI'),
    ('ORACLE',     'Oracle Database',      4, 'O', 'AI'),
    ('SQLSERVER',  'Microsoft SQL Server', 5, 'O', 'AI'),
    ('MONGODB',    'MongoDB',              6, 'O', 'AI')
ON CONFLICT (code) DO NOTHING;
