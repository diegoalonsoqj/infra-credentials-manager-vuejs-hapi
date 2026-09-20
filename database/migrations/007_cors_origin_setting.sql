-- =============================================================================
-- 007_cors_origin_setting.sql
-- Agrega el parámetro cors_origin a tbl_system_settings para permitir
-- configurar el origen CORS desde el panel de administración en tiempo de
-- ejecución, sin necesidad de reiniciar el servidor.
-- =============================================================================

INSERT INTO sch_system.tbl_system_settings
    (key, value, type, category, label, description, is_public)
VALUES
    ('cors_origin',
     'http://localhost',
     'string', 'security',
     'Origen CORS permitido (URL pública del frontend)',
     'URL completa del frontend (ej: https://icm.empresa.com). Debe incluir protocolo y dominio, sin barra final. El cambio tiene efecto inmediato sin reiniciar el servidor. Para que persista entre reinicios, también actualizar CORS_ORIGIN en el archivo .env.',
     FALSE)
ON CONFLICT (key) DO NOTHING;
