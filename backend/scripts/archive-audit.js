'use strict';

// =============================================================================
// archive-audit.js — Traslada la auditoría vencida al histórico.
//
// Uso (desde la carpeta backend/):
//   npm run archive-audit          → archiva lo que supere la retención
//   npm run archive-audit -- --dry → solo informa de cuánto habría movido
//
// POR QUÉ EXISTE
// El panel muestra "Retención en el log principal (días)" y hasta ahora nadie
// leía ese valor: la cadena 'audit_retention_days' no aparecía una sola vez en
// el backend. No se borraba ni se movía ninguna fila jamás, así que un evento
// de hace dos años seguía en la tabla activa. Quien leyera esa pantalla
// concluiría lo contrario.
//
// POR QUÉ ARCHIVA Y NO BORRA
// En un gestor de credenciales el rastro de quién descifró qué es la única
// prueba de lo que ha pasado. Las filas vencidas se trasladan a
// sch_audit.tbl_audit_log_historico: la tabla activa queda acotada a la ventana
// de retención y el rastro completo se conserva.
//
// ATENCIÓN: archivar NO es eliminar. Las filas siguen en la misma base de datos,
// con los mismos usuarios e IPs. Si alguna vez hay una obligación de SUPRIMIR
// datos personales pasado un plazo, esto no la cumple.
//
// PENSADO PARA CRON. Es idempotente: si no hay nada vencido no hace nada, y dos
// ejecuciones seguidas no duplican ni pierden filas.
// =============================================================================

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { query, withTransaction, closePool } = require('../src/config/database');

// Filas por transacción. Mover un año entero de golpe mantendría una transacción
// larga bloqueando escrituras de auditoría, que es tanto como bloquear logins y
// descifrados. Si el proceso se corta, lo ya trasladado queda consistente y el
// resto espera a la siguiente ejecución.
const TAM_LOTE = 10000;

const RETENCION_POR_DEFECTO = 365;

/** Días de retención según el panel, con respaldo si el valor no es utilizable. */
async function diasDeRetencion() {
  const { rows } = await query(
    `SELECT value FROM sch_system.tbl_system_settings WHERE key = 'audit_retention_days'`
  );
  const n = parseInt(rows[0]?.value, 10);
  if (Number.isNaN(n) || n < 1) {
    console.log(`  audit_retention_days ausente o no utilizable; se usan ${RETENCION_POR_DEFECTO} días.`);
    return RETENCION_POR_DEFECTO;
  }
  return n;
}

/**
 * Traslada un lote. Devuelve cuántas filas movió.
 *
 * El INSERT y el DELETE operan sobre EXACTAMENTE el mismo conjunto de ids,
 * fijado por el CTE. Seleccionar por fecha en el INSERT y volver a seleccionar
 * por fecha en el DELETE abriría una carrera con los eventos que entran entre
 * ambas sentencias.
 */
async function archivarLote(dias) {
  return withTransaction(async (client) => {
    const { rowCount } = await client.query(
      `WITH lote AS (
         SELECT id
         FROM sch_audit.tbl_audit_log
         WHERE created_at < NOW() - ($1 || ' days')::interval
         ORDER BY id
         LIMIT $2
       ),
       copiadas AS (
         INSERT INTO sch_audit.tbl_audit_log_historico
         SELECT a.*, NOW()
         FROM sch_audit.tbl_audit_log a
         JOIN lote l ON l.id = a.id
         ON CONFLICT (id) DO NOTHING
         RETURNING id
       )
       DELETE FROM sch_audit.tbl_audit_log a
       USING lote l
       WHERE a.id = l.id`,
      [String(dias), TAM_LOTE]
    );
    return rowCount || 0;
  });
}

async function main() {
  const dryRun = process.argv.includes('--dry');
  const dias   = await diasDeRetencion();

  const { rows: [pend] } = await query(
    `SELECT count(*)::int AS n, min(created_at) AS mas_antiguo
     FROM sch_audit.tbl_audit_log
     WHERE created_at < NOW() - ($1 || ' days')::interval`,
    [String(dias)]
  );

  console.log(`\nRetención configurada: ${dias} días.`);
  console.log(`Eventos vencidos: ${pend.n}${pend.n ? ` (el más antiguo, de ${pend.mas_antiguo.toISOString().slice(0, 10)})` : ''}`);

  if (pend.n === 0) {
    console.log('\n✓ No hay nada que archivar.\n');
    return;
  }

  if (dryRun) {
    console.log('\n(--dry: no se movió nada)\n');
    return;
  }

  console.log('\nArchivando...');
  let total = 0;
  for (;;) {
    const movidas = await archivarLote(dias);
    if (movidas === 0) break;
    total += movidas;
    console.log(`    lote de ${movidas} filas (acumulado: ${total})`);
  }

  const { rows: [fin] } = await query(
    `SELECT (SELECT count(*)::int FROM sch_audit.tbl_audit_log)           AS activo,
            (SELECT count(*)::int FROM sch_audit.tbl_audit_log_historico) AS historico`
  );

  console.log(`\n✓ ${total} eventos trasladados al histórico.`);
  console.log(`  log activo: ${fin.activo}  |  histórico: ${fin.historico}\n`);
}

main()
  .catch((err) => {
    console.error('\n✗ Error:', err.message, '\n');
    process.exitCode = 1;
  })
  .finally(() => closePool().catch(() => {}));
