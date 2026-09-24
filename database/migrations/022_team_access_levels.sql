-- =============================================================================
-- 022_team_access_levels.sql
--
-- Nivel de acceso por tipo de recurso en cada equipo, y equipo propietario de
-- cada credencial y cada recurso.
--
-- Caso que lo motiva: el equipo de Monitoreo hace los pases y atiende fuera de
-- horario. Necesita ver y descifrar las credenciales de todos los tipos (DB, OS,
-- APP, NET), pero no modificar las de otros equipos. Y tiene sus propios
-- desarrollos y accesos, que gestiona como cualquier equipo.
--
-- tbl_team_resource_types.access_level
--   FULL  como hasta ahora: ver y modificar todo lo de ese tipo. Todas las filas
--         existentes quedan en FULL: ningún equipo cambia de comportamiento.
--   READ  "Consulta": ver todo lo de ese tipo (y descifrar, si el rol lo
--         permite), pero modificar solo lo que pertenece al propio equipo. Crear
--         sí puede: lo creado pasa a ser de su equipo.
--
-- owner_team_id (credenciales y los cuatro tipos de recurso)
--   Equipo de quien lo creó. NULL en lo que ya existía y en lo que crea un ADMIN
--   (no tiene equipo): para un equipo con acceso READ, eso es de otro equipo.
--   A los equipos con acceso FULL no les afecta: modifican todo lo de su tipo.
--
-- El motivo del descifrado (READ sobre una credencial de otro equipo) no
-- necesita columna: va en extra_data.motivo del evento CREDENTIAL_DECRYPT.
-- =============================================================================

ALTER TABLE sch_system.tbl_team_resource_types
    ADD COLUMN access_level VARCHAR(10) NOT NULL DEFAULT 'FULL'
        CONSTRAINT chk_team_resource_types_access_level CHECK (access_level IN ('FULL', 'READ'));

COMMENT ON COLUMN sch_system.tbl_team_resource_types.access_level IS
    'FULL: ver y modificar todo lo del tipo. READ (consulta): ver todo, modificar solo lo de su equipo.';

ALTER TABLE sch_secret.tbl_credentials
    ADD COLUMN owner_team_id SMALLINT REFERENCES sch_system.tbl_teams(id);
ALTER TABLE sch_system.tbl_servers
    ADD COLUMN owner_team_id SMALLINT REFERENCES sch_system.tbl_teams(id);
ALTER TABLE sch_system.tbl_db_services
    ADD COLUMN owner_team_id SMALLINT REFERENCES sch_system.tbl_teams(id);
ALTER TABLE sch_system.tbl_applications
    ADD COLUMN owner_team_id SMALLINT REFERENCES sch_system.tbl_teams(id);
ALTER TABLE sch_system.tbl_network_devices
    ADD COLUMN owner_team_id SMALLINT REFERENCES sch_system.tbl_teams(id);

COMMENT ON COLUMN sch_secret.tbl_credentials.owner_team_id     IS 'Equipo de quien la creó. NULL: creada por ADMIN o antes de la migración 022.';
COMMENT ON COLUMN sch_system.tbl_servers.owner_team_id         IS 'Equipo de quien lo creó. NULL: creado por ADMIN o antes de la migración 022.';
COMMENT ON COLUMN sch_system.tbl_db_services.owner_team_id     IS 'Equipo de quien lo creó. NULL: creado por ADMIN o antes de la migración 022.';
COMMENT ON COLUMN sch_system.tbl_applications.owner_team_id    IS 'Equipo de quien la creó. NULL: creada por ADMIN o antes de la migración 022.';
COMMENT ON COLUMN sch_system.tbl_network_devices.owner_team_id IS 'Equipo de quien lo creó. NULL: creado por ADMIN o antes de la migración 022.';
