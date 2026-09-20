-- =============================================================================
-- 011_fix_password_min_length_seed.sql
--
-- Corrige el valor sembrado de password_min_length, que 003 dejó en 10 mientras
-- el código exigía 12.
--
-- Hasta esta ronda el ajuste no lo leía nadie: las rutas validaban con
-- Joi.string().min(12) y crypto.js con un 12 fijo. El panel de administración
-- mostraba "Longitud mínima de contraseña de usuario: 10", de modo que no era
-- un control inerte sino uno que mostraba un número FALSO — un administrador
-- que leyera esa pantalla concluiría que la política admite contraseñas de 10
-- caracteres, cuando el sistema rechazaba cualquiera por debajo de 12.
--
-- Ahora el ajuste sí se aplica (config/settings.js), con dos salvaguardas:
--   - crypto.js acota por abajo a PASSWORD_MIN_LENGTH_FLOOR = 12, de modo que
--     editar esta fila a mano tampoco puede relajar la política.
--   - PUT /api/system/settings/password_min_length rechaza valores < 12 con un
--     mensaje explícito, en vez de aceptarlos y no aplicarlos.
--
-- Solo se toca el valor si sigue siendo el sembrado por 003: si una instalación
-- ya lo subió a 14 o 16, se respeta.
-- =============================================================================

UPDATE sch_system.tbl_system_settings
SET value = '12',
    updated_at = NOW()
WHERE key = 'password_min_length'
  AND value = '10';
