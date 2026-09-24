<template>
  <div style="height: 100%; overflow: hidden; display: flex; flex-direction: column; background: var(--cui-tertiary-bg); padding: 1.5rem">
    <CContainer style="flex: 1; display: flex; flex-direction: column; overflow: hidden">

      <!-- Filtros -->
      <CCard class="shadow-sm mb-3" style="flex-shrink: 0">
        <CCardBody class="py-2">
          <form @submit.prevent="handleApply">
            <div class="d-flex gap-2 align-items-center flex-wrap">
              <CFormInput v-if="canReadLog" size="sm" placeholder="Usuario..."
                v-model="filters.username" style="flex: 1; min-width: 90px" />
              <CFormSelect size="sm" v-model="filters.action" style="flex: 1; min-width: 130px">
                <option value="" disabled hidden>Acción</option>
                <template v-if="canReadLog">
                  <option v-for="a in availableActions" :key="a" :value="a">{{ ACTION_LABELS[a] || a }}</option>
                </template>
                <template v-else>
                  <option v-for="[k, v] in Object.entries(ACTION_LABELS)" :key="k" :value="k">{{ v }}</option>
                </template>
              </CFormSelect>
              <CFormSelect v-if="canReadLog" size="sm" v-model="filters.resourceType" style="width: 85px">
                <option value="" disabled hidden>Tipo</option>
                <option v-for="t in typeOptions" :key="t" :value="t">{{ t }}</option>
              </CFormSelect>
              <CFormSelect size="sm" v-model="filters.result" style="width: 105px">
                <option value="" disabled hidden>Resultado</option>
                <option value="S">OK</option>
                <option value="F">Error</option>
              </CFormSelect>
              <CFormSelect v-if="canReadLog" size="sm" v-model="filters.isPrdAccess" style="width: 85px">
                <option value="" disabled hidden>PRD</option>
                <option value="true">Solo PRD</option>
              </CFormSelect>
              <CFormInput size="sm" type="date" v-model="filters.dateFrom" style="width: 135px" />
              <CFormInput size="sm" type="date" v-model="filters.dateTo" style="width: 135px" />
              <CButton type="submit" color="primary" variant="outline" size="sm">Buscar</CButton>
              <CButton v-if="hasFilters" type="button" color="secondary" variant="outline" size="sm" @click="handleReset">✕</CButton>
            </div>
          </form>
        </CCardBody>
      </CCard>

      <!-- Qué se está viendo, cuando el log está acotado al equipo -->
      <CAlert v-if="scope" color="info" class="py-2 small mb-3" style="flex-shrink: 0">
        <template v-if="scope.resourceTypes.length">
          Ves los eventos sobre recursos de tipo <strong>{{ scope.resourceTypes.join(', ') }}</strong>
          (los de tu equipo), los haga quien los haga, y tus propios eventos.
        </template>
        <template v-else>Tu usuario no tiene equipo asignado: solo ves tus propios eventos.</template>
      </CAlert>

      <!-- Tabla -->
      <CCard class="shadow-sm" style="flex: 1; display: flex; flex-direction: column; overflow: hidden">
        <CCardBody class="p-0" style="overflow: auto; flex: 1">
          <div v-if="loading" class="d-flex justify-content-center py-4"><CSpinner size="sm" /></div>
          <CAlert v-else-if="error" color="danger" class="m-3">{{ error }}</CAlert>
          <p v-else-if="records.length === 0" class="text-center text-medium-emphasis small py-4 mb-0">
            Sin registros para los filtros seleccionados.
          </p>
          <CTable v-else small hover class="mb-0" style="font-size: 12px">
            <CTableHead style="position: sticky; top: 0; z-index: 2; background: var(--cui-body-bg)">
              <CTableRow>
                <CTableHeaderCell>Fecha</CTableHeaderCell>
                <CTableHeaderCell v-if="canReadLog">Usuario</CTableHeaderCell>
                <CTableHeaderCell>Acción</CTableHeaderCell>
                <CTableHeaderCell v-if="canReadLog">Tipo</CTableHeaderCell>
                <CTableHeaderCell>Recurso</CTableHeaderCell>
                <CTableHeaderCell>Resultado</CTableHeaderCell>
                <CTableHeaderCell>IP</CTableHeaderCell>
                <CTableHeaderCell v-if="canReadLog">Flags</CTableHeaderCell>
              </CTableRow>
            </CTableHead>
            <CTableBody>
              <CTableRow v-for="row in records" :key="row.id">
                <CTableDataCell class="text-medium-emphasis" style="white-space: nowrap">
                  {{ new Date(row.created_at).toLocaleString('es-PE') }}
                </CTableDataCell>
                <CTableDataCell v-if="canReadLog" class="fw-semibold">
                  <span v-if="row.username">{{ row.username }}</span>
                  <span v-else class="text-medium-emphasis">sistema</span>
                </CTableDataCell>
                <CTableDataCell>{{ ACTION_LABELS[row.action] || row.action }}</CTableDataCell>
                <CTableDataCell v-if="canReadLog">
                  <CBadge v-if="row.resource_type" color="secondary">{{ row.resource_type }}</CBadge>
                  <span v-else class="text-medium-emphasis">—</span>
                </CTableDataCell>
                <CTableDataCell>
                  <span v-if="row.resource_name">{{ row.resource_name }}</span>
                  <span v-else class="text-medium-emphasis">—</span>
                  <div v-if="row.fail_reason" class="text-danger" style="font-size: 11px">{{ row.fail_reason }}</div>
                  <!-- Motivo que se pide al descifrar, con acceso de consulta, una credencial de otro equipo -->
                  <div v-if="extraOf(row).motivo" class="text-medium-emphasis" style="font-size: 11px">
                    <strong>Motivo:</strong> {{ extraOf(row).motivo }}
                  </div>
                </CTableDataCell>
                <CTableDataCell>
                  <CBadge :color="RESULT_LABELS[row.result]?.color || 'secondary'">
                    {{ RESULT_LABELS[row.result]?.label || row.result }}
                  </CBadge>
                </CTableDataCell>
                <CTableDataCell class="text-medium-emphasis">{{ row.ip_address || '—' }}</CTableDataCell>
                <CTableDataCell v-if="canReadLog">
                  <div class="d-flex gap-1">
                    <CBadge v-if="row.is_prd_access" color="danger" style="font-size: 10px">PRD</CBadge>
                    <CBadge v-if="row.is_custodied_access" color="warning" text-color="dark" style="font-size: 10px">
                      <Lock :size="12" />
                    </CBadge>
                  </div>
                </CTableDataCell>
              </CTableRow>
            </CTableBody>
          </CTable>
        </CCardBody>
      </CCard>

      <!-- Footer paginación -->
      <div class="d-flex align-items-center justify-content-between gap-2 pt-2" style="font-size: 13px">
        <div class="d-flex align-items-center gap-2 text-medium-emphasis">
          <span>Mostrar:</span>
          <CFormSelect size="sm" style="width: auto" :model-value="limit"
            @change="limit = Number($event.target.value); page = 1">
            <option :value="15">15</option>
            <option :value="30">30</option>
            <option :value="50">50</option>
            <option :value="100">100</option>
          </CFormSelect>
          <span>{{ total === 0 ? 'Sin resultados' : `Mostrando ${(page - 1) * limit + 1}–${Math.min(page * limit, total)} de ${total}` }}</span>
        </div>
        <CPagination class="mb-0" size="sm">
          <CPaginationItem :disabled="page <= 1" @click="page > 1 && changePage(page - 1)"
            :style="{ cursor: page > 1 ? 'pointer' : 'default' }">«</CPaginationItem>
          <template v-for="(p, i) in paginationPages(page, totalPages)" :key="i">
            <CPaginationItem v-if="p === '...'" disabled>…</CPaginationItem>
            <CPaginationItem v-else :active="p === page" @click="changePage(p)" style="cursor: pointer">{{ p }}</CPaginationItem>
          </template>
          <CPaginationItem :disabled="page >= totalPages" @click="page < totalPages && changePage(page + 1)"
            :style="{ cursor: page < totalPages ? 'pointer' : 'default' }">»</CPaginationItem>
        </CPagination>
      </div>

    </CContainer>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { Lock } from 'lucide-vue-next'
import { useAuthStore } from '../../store/authStore.js'
import api from '../../api/index.js'

const authStore = useAuthStore()
// Se decide por permisos, no por el nombre del rol: antes un rol con MOD_AUDIT
// que no se llamara ADMIN recibía del backend el log completo y la pantalla le
// enseñaba solo lo suyo.
const hasFullLog = computed(() => authStore.hasPermission('MOD_AUDIT'))
const canReadLog = computed(() => hasFullLog.value || authStore.hasPermission('AUDIT_TEAM'))
// Tipos del filtro: todos con el log completo; con AUDIT_TEAM, los de su equipo
// y SYS (sus propios inicios de sesión y demás).
const typeOptions = computed(() => hasFullLog.value
  ? ['DB', 'OS', 'APP', 'NET', 'SYS']
  : [...(authStore.user?.teamResourceTypes || []), 'SYS'])
// Ámbito que devuelve el backend: null = log completo.
const scope = ref(null)

const RESULT_LABELS = { S: { label: 'OK', color: 'success' }, F: { label: 'Error', color: 'danger' } }
const ACTION_LABELS = {
  LOGIN_SUCCESS: 'Inicio de sesión', LOGIN_FAIL: 'Intento fallido de login',
  LOGOUT: 'Cierre de sesión', SESSION_REVOKED: 'Sesión revocada',
  CREDENTIAL_VIEW: 'Ver credencial', CREDENTIAL_DECRYPT: 'Descifrar credencial',
  CREDENTIAL_CREATE: 'Crear credencial', CREDENTIAL_UPDATE: 'Editar credencial',
  CREDENTIAL_DELETE: 'Eliminar credencial', CUSTODIED_ACCESS_DENIED: 'Acceso custodia denegado',
  CUSTODIED_ACCESS_GRANTED: 'Acceso custodia concedido', CUSTODIAN_ASSIGN: 'Asignar custodio',
  CUSTODIAN_REASSIGN: 'Reasignar custodio', USER_CREATE: 'Crear usuario',
  USER_UPDATE: 'Editar usuario', USER_DEACTIVATE: 'Desactivar usuario',
  RESOURCE_DB_CREATE: 'Crear base de datos', RESOURCE_DB_UPDATE: 'Editar base de datos',
  RESOURCE_DB_DELETE: 'Eliminar base de datos', RESOURCE_DB_INSTANCE_CREATE: 'Crear instancia BD',
  RESOURCE_DB_INSTANCE_UPDATE: 'Editar instancia BD', RESOURCE_DB_INSTANCE_DELETE: 'Eliminar instancia BD',
  RESOURCE_OS_CREATE: 'Crear servidor', RESOURCE_OS_UPDATE: 'Editar servidor',
  RESOURCE_OS_DELETE: 'Eliminar servidor',
  RESOURCE_APP_CREATE: 'Crear aplicación', RESOURCE_APP_UPDATE: 'Editar aplicación',
  RESOURCE_APP_DELETE: 'Eliminar aplicación',
  RESOURCE_NET_CREATE: 'Crear dispositivo de red', RESOURCE_NET_UPDATE: 'Editar dispositivo de red',
  RESOURCE_NET_DELETE: 'Eliminar dispositivo de red',
  LDAP_CONFIG_UPDATE: 'Cambiar conexión LDAP', LDAP_TEST: 'Probar conexión LDAP',
  SETUP_COMPLETED: 'Instalación completada', MASTER_KEY_ROTATION_START: 'Inicio rotación Master Key',
  MASTER_KEY_ROTATION_SUCCESS: 'Rotación Master Key exitosa', MASTER_KEY_ROTATION_FAIL: 'Rotación Master Key fallida',
}

const EMPTY_FILTERS = { username: '', action: '', resourceType: '', result: '', isPrdAccess: '', dateFrom: '', dateTo: '' }

const records          = ref([])
const total            = ref(0)
const page             = ref(1)
const limit            = ref(30)
const loading          = ref(false)
const error            = ref(null)
const filters          = reactive({ ...EMPTY_FILTERS })
const applied          = reactive({ ...EMPTY_FILTERS })
const availableActions = ref([])

const totalPages = computed(() => Math.ceil(total.value / limit.value) || 1)
const hasFilters = computed(() => Object.values(applied).some(Boolean))

// extra_data llega como objeto (JSONB); se tolera texto por si acaso.
function extraOf(row) {
  const e = row.extra_data
  if (!e) return {}
  if (typeof e === 'object') return e
  try { return JSON.parse(e) } catch { return {} }
}

function paginationPages(current, tot) {
  if (tot <= 7) return Array.from({ length: tot }, (_, i) => i + 1)
  const pages = [1]
  if (current > 3) pages.push('...')
  for (let i = Math.max(2, current - 1); i <= Math.min(tot - 1, current + 1); i++) pages.push(i)
  if (current < tot - 2) pages.push('...')
  pages.push(tot)
  return pages
}

async function load() {
  loading.value = true; error.value = null
  try {
    const params = { page: page.value, limit: limit.value }
    if (applied.action)       params.action       = applied.action
    if (applied.result)       params.result       = applied.result
    if (applied.dateFrom)     params.dateFrom     = applied.dateFrom
    if (applied.dateTo)       params.dateTo       = applied.dateTo
    if (canReadLog.value) {
      if (applied.username)     params.username     = applied.username
      if (applied.resourceType) params.resourceType = applied.resourceType
      if (applied.isPrdAccess)  params.isPrdAccess  = applied.isPrdAccess
    }
    const endpoint = canReadLog.value ? '/audit' : '/audit/me'
    const data = await api.get(endpoint, { params })
    records.value = data.records || []
    total.value   = data.total   || 0
    scope.value   = data.scope   || null
  } catch (err) {
    error.value = err?.message || 'Error al cargar el log de auditoría.'
  } finally {
    loading.value = false
  }
}

function handleApply() {
  Object.assign(applied, { ...filters })
  page.value = 1
  load()
}

function handleReset() {
  Object.assign(filters, { ...EMPTY_FILTERS })
  Object.assign(applied, { ...EMPTY_FILTERS })
  page.value = 1
  load()
}

function changePage(p) {
  page.value = p
  load()
}

watch(page, load)

onMounted(async () => {
  if (canReadLog.value) {
    try {
      const data = await api.get('/audit/actions')
      availableActions.value = data.actions || []
    } catch { /* silencioso */ }
  }
  await load()
})
</script>
