-- =============================================================================
-- 021_supervisor_role.sql
--
-- Rol SUPERVISOR "Supervisor de equipo": líderes que deben ver la auditoría de
-- su área pero no las credenciales.
--
-- Es un rol y no una casilla en el usuario a propósito: todos los permisos de la
-- aplicación van por rol, y una excepción guardada en la ficha del usuario sería
-- una segunda vía de acceso que nadie ve al revisar los roles.
--
-- Permisos:
--   AUDIT_TEAM  auditoría de los tipos de recurso de su equipo (migración 020).
--   RES_VIEW    ver el inventario (servidores, dispositivos…) de su equipo.
--   MOD_PWDGEN  generador de contraseñas, como el resto de roles.
-- Sin CRED_VIEW, CRED_EDIT ni CRED_REVEAL: no ve la lista de credenciales, no
-- las crea ni descifra, y no puede ser custodio (custody.js exige CRED_REVEAL).
-- Lo aplica el backend en cada petición, no solo la pantalla.
--
-- Nivel 60: entre OPERATOR (50) y LEADER (70). Como cualquier nivel entre 1 y
-- 99, exige equipo asignado, que es lo que acota su auditoría.
-- =============================================================================

INSERT INTO sch_system.tbl_roles (code, name, level, description, is_system, estado_registro, estado)
VALUES ('SUPERVISOR', 'Supervisor de equipo', 60,
        'Ve la auditoría y el inventario de su equipo. Sin acceso a credenciales.', TRUE, 'O', 'AI')
ON CONFLICT (code) DO NOTHING;

COMMENT ON COLUMN sch_system.tbl_roles.level IS 'ADMIN=100, LEADER=70, SUPERVISOR=60, OPERATOR=50, VIEWER=20, VISITOR=0.';

INSERT INTO sch_system.tbl_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM sch_system.tbl_roles r
CROSS JOIN sch_system.tbl_permissions p
WHERE r.code = 'SUPERVISOR' AND p.code IN ('MOD_PWDGEN', 'RES_VIEW', 'AUDIT_TEAM')
ON CONFLICT DO NOTHING;
