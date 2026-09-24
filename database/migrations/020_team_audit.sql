-- =============================================================================
-- 020_team_audit.sql
--
-- Auditoría para líderes de equipo.
--
-- Hasta ahora la auditoría tenía dos modos: el log completo (MOD_AUDIT, solo
-- ADMIN) o los eventos propios de cada usuario. Un líder de DBA no podía ver
-- quién de su equipo había descifrado qué credencial de base de datos.
--
-- AUDIT_TEAM  permiso nuevo: ver los eventos sobre los tipos de recurso del
--             equipo del usuario (tbl_team_resource_types), los haga quien los
--             haga, más sus propios eventos. Un líder cuyo equipo tiene OS y NET
--             ve todo lo de servidores y red, pero nada de bases de datos ni los
--             inicios de sesión de otros usuarios (eventos SYS ajenos).
--
-- LEADER      rol nuevo "Líder de equipo" (nivel 70): lo mismo que OPERATOR más
--             AUDIT_TEAM. Como OPERATOR y VIEWER, exige equipo asignado. El
--             permiso también se puede añadir a cualquier otro rol desde
--             Catálogos → Roles.
-- =============================================================================

INSERT INTO sch_system.tbl_permissions (code, description)
VALUES ('AUDIT_TEAM', 'Auditoría de los recursos de su equipo')
ON CONFLICT (code) DO NOTHING;

INSERT INTO sch_system.tbl_roles (code, name, level, description, is_system, estado_registro, estado)
VALUES ('LEADER', 'Líder de equipo', 70,
        'Como Operador, y además ve la auditoría de los recursos de su equipo.', TRUE, 'O', 'AI')
ON CONFLICT (code) DO NOTHING;

COMMENT ON COLUMN sch_system.tbl_roles.level IS 'ADMIN=100, LEADER=70, OPERATOR=50, VIEWER=20, VISITOR=0.';

-- LEADER: el conjunto base de OPERATOR (el de 002, no el que tenga ahora: un
-- ADMIN pudo haberlo cambiado) más AUDIT_TEAM. ADMIN recibe AUDIT_TEAM por
-- coherencia con "todos los permisos", aunque MOD_AUDIT ya le da el log entero.
INSERT INTO sch_system.tbl_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM sch_system.tbl_roles r
CROSS JOIN sch_system.tbl_permissions p
WHERE (r.code = 'LEADER' AND p.code IN (
          'MOD_PWDGEN',
          'CRED_VIEW', 'CRED_EDIT', 'CRED_DELETE', 'CRED_REVEAL',
          'RES_VIEW',  'RES_EDIT',  'RES_DELETE',
          'AUDIT_TEAM'))
   OR (r.code = 'ADMIN' AND p.code = 'AUDIT_TEAM')
ON CONFLICT DO NOTHING;
