-- =============================================================================
-- 015_account_lockout_settings.sql
--
-- El bloqueo de cuenta por intentos fallidos (5 fallos, 15 minutos) era una
-- constante en auth.service.js: el único límite de acceso que no se podía
-- ajustar sin tocar código. Pasa a tbl_system_settings, junto a la duración de
-- sesión y las sesiones concurrentes, y el login lo lee con config/settings.js.
--
-- Se siembran los mismos valores que tenía el código, así que el
-- comportamiento no cambia al aplicar la migración. Rangos (los valida el PUT
-- de /api/system/settings y, por segunda vez, auth.service al leerlos):
--   - account_lockout_attempts: 3–20. Con 1 o 2, un error al teclear bloquea
--     la cuenta; por encima de 20 la protección contra fuerza bruta se diluye.
--   - account_lockout_minutes:  1–1440 (un día).
-- =============================================================================

INSERT INTO sch_system.tbl_system_settings
    (key, value, type, category, label, description, is_public)
VALUES
    ('account_lockout_attempts',
     '5',
     'integer', 'security',
     'Intentos fallidos antes de bloquear la cuenta',
     'Al llegar a este número de contraseñas incorrectas seguidas, la cuenta se bloquea temporalmente. Entre 3 y 20.',
     FALSE),

    ('account_lockout_minutes',
     '15',
     'integer', 'security',
     'Duración del bloqueo de cuenta (minutos)',
     'Tiempo que la cuenta permanece bloqueada tras superar los intentos fallidos. Un administrador puede desbloquearla antes desde Usuarios. Entre 1 y 1440.',
     FALSE)
ON CONFLICT (key) DO NOTHING;
