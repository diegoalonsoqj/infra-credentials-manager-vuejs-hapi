-- =============================================================================
-- 008_purge_deleted_credential_secrets.sql
--
-- Una credencial eliminada lógicamente conservaba su contraseña cifrada. Eso
-- causaba dos problemas:
--
--   1. Minimización de datos: la fila se mantiene por auditoría, pero no hay
--      ninguna razón para seguir guardando el secreto de una credencial que ya
--      no existe. Nunca se puede descifrar por la aplicación —decryptPassword
--      filtra estado_registro = 'O' AND estado = 'AI'— así que solo es un
--      secreto muerto esperando a que alguien lea la tabla.
--
--   2. Rotación de Master Key: el re-cifrado abarca únicamente las filas con
--      estado_registro = 'O', de modo que las eliminadas se quedaban cifradas
--      con la clave anterior, que se descarta en ese mismo momento. Quedaban
--      como texto cifrado irrecuperable, y la deuda crecía con cada rotación:
--      si algún día se ampliara el re-cifrado a todas las filas, la operación
--      fallaría entera al toparse con ellas (pgp_sym_decrypt: "Wrong key or
--      corrupt data") porque el UPDATE es una sola sentencia atómica.
--
-- A partir de aquí el secreto se purga en el propio borrado lógico
-- (credentials.repository.softDelete), y la columna admite NULL para poder
-- representarlo. Esta migración limpia además las filas ya existentes.
-- =============================================================================

ALTER TABLE sch_secret.tbl_credentials
    ALTER COLUMN password_encrypted DROP NOT NULL;

UPDATE sch_secret.tbl_credentials
   SET password_encrypted = NULL
 WHERE estado_registro = 'X'
   AND password_encrypted IS NOT NULL;

COMMENT ON COLUMN sch_secret.tbl_credentials.password_encrypted IS
    'Contraseña cifrada con pgcrypto (pgp_sym_encrypt). NULL en credenciales eliminadas lógicamente: el secreto se purga al borrar.';
