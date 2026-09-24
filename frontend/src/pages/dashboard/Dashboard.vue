<template>
  <div style="height: 100%; overflow-y: auto; padding: 1.5rem">
    <CContainer fluid>

      <div v-if="error" class="alert alert-danger py-2 small mb-3">{{ error }}</div>

      <!-- KPI Row 1 -->
      <CRow class="g-3 mb-3">
        <CCol :xs="6" :md="3" v-for="card in kpiRow1" :key="card.label">
          <CCard class="shadow-sm h-100" :style="{ borderTop: `3px solid var(--cui-${card.color})` }">
            <CCardBody class="p-3">
              <div class="d-flex align-items-start justify-content-between">
                <div>
                  <div class="text-medium-emphasis mb-1" style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px">{{ card.label }}</div>
                  <div class="fw-bold fs-4">
                    <CSpinner v-if="card.value === null" size="sm" />
                    <template v-else>{{ card.value }}</template>
                  </div>
                  <div v-if="card.sub" class="text-medium-emphasis mt-1" style="font-size: 11px">{{ card.sub }}</div>
                </div>
                <span :style="{ color: `var(--cui-${card.color})`, opacity: 0.8 }">
                  <component :is="card.icon" :size="22" />
                </span>
              </div>
            </CCardBody>
          </CCard>
        </CCol>
      </CRow>

      <!-- KPI Row 2 -->
      <CRow class="g-3 mb-4">
        <CCol :xs="6" :md="4" :xl="2" v-for="card in kpiRow2" :key="card.label">
          <CCard class="shadow-sm h-100" :style="{ borderTop: `3px solid var(--cui-${card.color})` }">
            <CCardBody class="p-3">
              <div class="d-flex align-items-start justify-content-between">
                <div>
                  <div class="text-medium-emphasis mb-1" style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px">{{ card.label }}</div>
                  <div class="fw-bold fs-5">
                    <CSpinner v-if="card.value === null" size="sm" />
                    <template v-else>{{ card.value }}</template>
                  </div>
                  <div v-if="card.sub" class="text-medium-emphasis mt-1" style="font-size: 11px">{{ card.sub }}</div>
                </div>
                <span :style="{ color: `var(--cui-${card.color})`, opacity: 0.5 }">
                  <component :is="card.icon" :size="22" />
                </span>
              </div>
            </CCardBody>
          </CCard>
        </CCol>
      </CRow>

      <!-- Bottom row -->
      <CRow class="g-3">

        <!-- Actividad reciente -->
        <CCol :md="7">
          <CCard class="h-100 shadow-sm">
            <CCardHeader class="d-flex align-items-center justify-content-between py-2 px-3">
              <span class="fw-semibold small">{{ actividadPropia ? 'Mi Actividad Reciente' : 'Actividad Reciente' }}</span>
              <CBadge color="secondary" class="small">Últimas 8</CBadge>
            </CCardHeader>
            <CCardBody class="p-0">
              <div v-if="loading" class="d-flex justify-content-center py-4"><CSpinner size="sm" /></div>
              <p v-else-if="recentActivity.length === 0" class="text-medium-emphasis small p-3 mb-0">Sin actividad registrada.</p>
              <div v-else class="table-responsive">
                <table class="table table-sm table-hover mb-0" style="font-size: 12px">
                  <thead>
                    <tr>
                      <th class="ps-3">Acción</th><th>Usuario</th><th>Recurso</th><th>Resultado</th><th class="pe-3">Fecha</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(row, i) in recentActivity" :key="i">
                      <td class="ps-3">{{ ACTION_LABELS[row.action] || row.action }}</td>
                      <td>{{ row.username }}</td>
                      <td>
                        <CBadge v-if="row.resource_type"
                          :color="TYPE_COLORS[row.resource_type] || 'secondary'"
                          class="me-1 small">{{ row.resource_type }}</CBadge>
                        <span class="text-truncate" style="max-width: 120px; display: inline-block; vertical-align: middle">
                          {{ row.resource_name || '—' }}
                        </span>
                      </td>
                      <td>
                        <!-- tbl_audit_log.result guarda 'S' (éxito) o 'F' (fallo), igual que en AuditPage -->
                        <CBadge :color="row.result === 'S' ? 'success' : 'danger'" class="small">{{ row.result === 'S' ? 'OK' : 'Error' }}</CBadge>
                      </td>
                      <td class="pe-3 text-medium-emphasis">{{ formatDate(row.created_at) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CCardBody>
          </CCard>
        </CCol>

        <!-- Por ambiente -->
        <CCol :md="5">
          <CCard class="h-100 shadow-sm">
            <CCardHeader class="d-flex align-items-center justify-content-between py-2 px-3">
              <span class="fw-semibold small">Credenciales por Ambiente</span>
              <CBadge color="secondary" class="small">Top 10</CBadge>
            </CCardHeader>
            <CCardBody class="px-3 py-2">
              <div v-if="loading" class="d-flex justify-content-center py-4"><CSpinner size="sm" /></div>
              <p v-else-if="byEnvironment.length === 0" class="text-medium-emphasis small mb-0">Sin datos.</p>
              <div v-else class="d-flex flex-column gap-2">
                <div v-for="(row, i) in byEnvironment" :key="i">
                  <div class="d-flex justify-content-between align-items-center mb-1">
                    <div class="d-flex align-items-center gap-2" style="font-size: 12px">
                      <CBadge v-if="row.prd_flag" color="danger" class="small" style="font-size: 10px">PRD</CBadge>
                      <span class="fw-medium">{{ row.env_name || row.env_code || 'Sin ambiente' }}</span>
                    </div>
                    <span class="fw-semibold small">{{ row.total }}</span>
                  </div>
                  <div class="rounded" style="height: 6px; background: var(--cui-border-color); overflow: hidden">
                    <div class="rounded" :style="{
                      height: '100%',
                      width: Math.round((row.total / maxEnvTotal) * 100) + '%',
                      background: row.prd_flag ? 'var(--cui-danger)' : 'var(--cui-primary)',
                      transition: 'width 0.4s ease',
                    }" />
                  </div>
                </div>
              </div>
            </CCardBody>
          </CCard>
        </CCol>

      </CRow>
    </CContainer>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { KeyRound, LockKeyhole, Database, Monitor, Smartphone, ShieldCheck, Network } from 'lucide-vue-next'
import api from '../../api/index.js'

const TYPE_COLORS = { DB: 'info', OS: 'warning', APP: 'success', NET: 'primary', SYS: 'secondary' }

const ACTION_LABELS = {
  CREATE_CREDENTIAL: 'Crear credencial',
  UPDATE_CREDENTIAL: 'Editar credencial',
  DELETE_CREDENTIAL: 'Eliminar credencial',
  DECRYPT_PASSWORD:  'Consultar contraseña',
  TOGGLE_ESTADO:     'Cambiar estado',
  LOGIN:             'Inicio de sesión',
  LOGOUT:            'Cierre de sesión',
  CREATE_USER:       'Crear usuario',
  UPDATE_USER:       'Editar usuario',
}

const dashData      = ref(null)
const loading       = ref(true)
const error         = ref(null)

const stats          = computed(() => dashData.value?.stats || {})
const recentActivity = computed(() => dashData.value?.recentActivity || [])
// El backend acota la lista a la actividad propia salvo con permiso MOD_AUDIT.
const actividadPropia = computed(() => dashData.value?.recentActivityScope === 'own')
const byEnvironment  = computed(() => dashData.value?.byEnvironment || [])
const maxEnvTotal    = computed(() => byEnvironment.value.reduce((m, r) => Math.max(m, r.total), 0) || 1)

const kpiRow1 = computed(() => [
  { icon: KeyRound,   label: 'Total Credenciales', value: loading.value ? null : stats.value.total ?? '—',    color: 'primary' },
  { icon: ShieldCheck, label: 'Custodiadas',       value: loading.value ? null : stats.value.custodied ?? '—',
    sub: loading.value ? null : (stats.value.total ? Math.round((stats.value.custodied / stats.value.total) * 100) + '%' : null),
    color: 'success' },
  { icon: Database, label: 'Base de Datos', value: loading.value ? null : stats.value.dbTotal ?? '—',
    sub: loading.value ? null : (stats.value.dbCustodied ?? 0) + ' custodiadas', color: 'info' },
  { icon: Monitor,  label: 'Servidores (OS)', value: loading.value ? null : stats.value.osTotal ?? '—',
    sub: loading.value ? null : (stats.value.osCustodied ?? 0) + ' custodiadas', color: 'warning' },
])

const kpiRow2 = computed(() => [
  { icon: Smartphone, label: 'Aplicaciones', value: loading.value ? null : stats.value.appTotal ?? '—',
    sub: loading.value ? null : (stats.value.appCustodied ?? 0) + ' custodiadas', color: 'success' },
  { icon: Network, label: 'Networking', value: loading.value ? null : stats.value.netTotal ?? '—',
    sub: loading.value ? null : (stats.value.netCustodied ?? 0) + ' custodiadas', color: 'primary' },
  { icon: LockKeyhole, label: 'Custodiadas DB', value: loading.value ? null : stats.value.dbCustodied ?? '—',
    sub: loading.value ? null : (stats.value.dbTotal ? Math.round((stats.value.dbCustodied / stats.value.dbTotal) * 100) + '% de BD' : null),
    color: 'info' },
  { icon: LockKeyhole, label: 'Custodiadas OS', value: loading.value ? null : stats.value.osCustodied ?? '—',
    sub: loading.value ? null : (stats.value.osTotal ? Math.round((stats.value.osCustodied / stats.value.osTotal) * 100) + '% de OS' : null),
    color: 'warning' },
  { icon: LockKeyhole, label: 'Custodiadas APP', value: loading.value ? null : stats.value.appCustodied ?? '—',
    sub: loading.value ? null : (stats.value.appTotal ? Math.round((stats.value.appCustodied / stats.value.appTotal) * 100) + '% de APP' : null),
    color: 'success' },
  { icon: LockKeyhole, label: 'Custodiadas NET', value: loading.value ? null : stats.value.netCustodied ?? '—',
    sub: loading.value ? null : (stats.value.netTotal ? Math.round((stats.value.netCustodied / stats.value.netTotal) * 100) + '% de NET' : null),
    color: 'primary' },
])

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-PE', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

onMounted(async () => {
  loading.value = true
  error.value   = null
  try {
    dashData.value = await api.get('/dashboard/stats')
  } catch (err) {
    error.value = err?.message || 'Error al cargar el dashboard.'
  } finally {
    loading.value = false
  }
})
</script>
