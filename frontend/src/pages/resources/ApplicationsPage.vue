<template>
  <div style="display: flex; flex-direction: column; height: 100%; overflow: hidden">

    <!-- Header + Filtros -->
    <div style="flex-shrink: 0; padding: 0.75rem 1.5rem 0.5rem">
      <div v-if="canWrite" class="d-flex justify-content-end mb-2">
        <CButton color="primary" size="sm"
          @click="openCreate">+ Nueva aplicación</CButton>
      </div>
      <CCard class="shadow-sm">
        <CCardBody class="py-2">
          <form @submit.prevent="handleApply">
            <div class="d-flex gap-2 align-items-center">
              <CFormInput size="sm" placeholder="Buscar por código o nombre..."
                v-model="filters.search" style="flex: 1" />
              <CFormSelect size="sm" v-model="filters.env" style="width: 140px">
                <option value="" disabled hidden>Ambiente</option>
                <option value="">Todos los ambientes</option>
                <option v-for="e in environments" :key="e.id" :value="String(e.id)">{{ e.code }} — {{ e.name }}</option>
              </CFormSelect>
              <CFormSelect size="sm" v-model="filters.appType" style="width: 110px">
                <option value="" disabled hidden>Tipo</option>
                <option value="">Todos</option>
                <option v-for="t in APP_TYPES" :key="t.value" :value="t.value">{{ t.value }}</option>
              </CFormSelect>
              <CButton type="submit" color="primary" variant="outline" size="sm">Buscar</CButton>
              <CButton v-if="hasFilters" type="button" color="secondary" variant="outline" size="sm"
                @click="handleReset">✕</CButton>
            </div>
          </form>
        </CCardBody>
      </CCard>
    </div>

    <!-- Tabla -->
    <div style="flex: 1; min-height: 0; padding: 0 1.5rem; display: flex; flex-direction: column">
      <CCard class="shadow-sm"
        style="flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden">
        <CCardBody
          style="padding: 0; flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden">
          <CAlert v-if="error" color="danger" class="m-3">{{ error }}</CAlert>
          <div v-if="loading" class="d-flex justify-content-center py-5"><CSpinner /></div>
          <div v-else style="flex: 1; overflow-y: auto">
            <CTable small hover class="mb-0 table-sticky-head" style="font-size: 13px">
              <CTableHead>
                <CTableRow>
                  <CTableHeaderCell>Código</CTableHeaderCell>
                  <CTableHeaderCell>Nombre</CTableHeaderCell>
                  <CTableHeaderCell>Tipo</CTableHeaderCell>
                  <CTableHeaderCell>Ambiente</CTableHeaderCell>
                  <CTableHeaderCell>Servidor</CTableHeaderCell>
                  <CTableHeaderCell>URL</CTableHeaderCell>
                  <CTableHeaderCell>Estado</CTableHeaderCell>
                  <CTableHeaderCell>Acciones</CTableHeaderCell>
                </CTableRow>
              </CTableHead>
              <CTableBody>
                <CTableRow v-if="applications.length === 0">
                  <CTableDataCell :colspan="8" class="text-center text-medium-emphasis py-4">
                    Sin aplicaciones. <template v-if="canWrite">Crea la primera con el botón +.</template>
                  </CTableDataCell>
                </CTableRow>
                <CTableRow v-for="app in applications" :key="app.id">
                  <CTableDataCell class="fw-semibold">{{ app.code }}</CTableDataCell>
                  <CTableDataCell>{{ app.name }}</CTableDataCell>
                  <CTableDataCell>
                    <CBadge :color="APP_TYPE_COLORS[app.app_type] || 'secondary'">{{ app.app_type }}</CBadge>
                  </CTableDataCell>
                  <CTableDataCell>
                    <CBadge color="light" text-color="dark">{{ app.environment_code }}</CBadge>
                  </CTableDataCell>
                  <CTableDataCell class="text-medium-emphasis" style="font-size: 11px">
                    <template v-if="app.server_code">{{ app.server_code }} — {{ app.server_name }}</template>
                    <em v-else>Externo/SaaS</em>
                  </CTableDataCell>
                  <CTableDataCell style="font-size: 11px; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
                    <a v-if="esEnlaceSeguro(app.url)" :href="app.url" target="_blank" rel="noreferrer" class="text-decoration-none">{{ app.url }}</a>
                    <span v-else-if="app.url">{{ app.url }}</span>
                    <span v-else class="text-medium-emphasis">—</span>
                  </CTableDataCell>
                  <CTableDataCell>
                    <CBadge :color="app.estado === 'AI' ? 'success' : 'secondary'">
                      {{ app.estado === 'AI' ? 'Activo' : 'Inactivo' }}
                    </CBadge>
                  </CTableDataCell>
                  <CTableDataCell class="text-end">
                    <!-- Con acceso de consulta a APP, solo se modifica lo del propio equipo -->
                    <div v-if="authStore.canModifyOwned('APP', app.owner_team_id)" class="d-flex gap-1 justify-content-end">
                      <template v-if="canWrite">
                        <CButton color="secondary" size="sm" variant="outline" title="Editar" @click="openEdit(app)">
                          <Pencil :size="13" />
                        </CButton>
                        <CButton :color="app.estado === 'AI' ? 'warning' : 'success'" size="sm" variant="outline"
                          :title="app.estado === 'AI' ? 'Desactivar' : 'Activar'"
                          @click="handleToggle(app)">
                          <PowerOff v-if="app.estado === 'AI'" :size="13" />
                          <Power v-else :size="13" />
                        </CButton>
                      </template>
                      <CButton v-if="canDelete" color="danger" size="sm" variant="outline" title="Eliminar" @click="openDelete(app)">
                        <Trash2 :size="13" />
                      </CButton>
                    </div>
                  </CTableDataCell>
                </CTableRow>
              </CTableBody>
            </CTable>
          </div>
        </CCardBody>
      </CCard>
    </div>

    <!-- Footer paginación -->
    <div style="flex-shrink: 0; padding: 0.5rem 1.5rem 1rem; display: flex; align-items: center; justify-content: space-between; gap: 1rem">
      <div class="d-flex align-items-center gap-2 text-medium-emphasis" style="font-size: 13px">
        <span>Mostrar:</span>
        <CFormSelect size="sm" style="width: auto" :model-value="limit"
          @change="limit = Number($event.target.value); page = 1">
          <option :value="15">15</option>
          <option :value="25">25</option>
          <option :value="50">50</option>
          <option :value="100">100</option>
        </CFormSelect>
        <span>{{ total === 0 ? 'Sin resultados' : `Mostrando ${(page - 1) * limit + 1}–${Math.min(page * limit, total)} de ${total}` }}</span>
      </div>
      <CPagination v-if="totalPages > 1" class="mb-0">
        <CPaginationItem :disabled="page <= 1" @click="page > 1 && changePage(page - 1)"
          :style="{ cursor: page > 1 ? 'pointer' : 'default' }">«</CPaginationItem>
        <template v-for="(p, i) in paginationPages(page, totalPages)" :key="i">
          <CPaginationItem v-if="p === '...'" disabled>…</CPaginationItem>
          <CPaginationItem v-else :active="p === page" @click="changePage(p)"
            style="cursor: pointer">{{ p }}</CPaginationItem>
        </template>
        <CPaginationItem :disabled="page >= totalPages" @click="page < totalPages && changePage(page + 1)"
          :style="{ cursor: page < totalPages ? 'pointer' : 'default' }">»</CPaginationItem>
      </CPagination>
    </div>

    <!-- Modal Crear -->
    <CModal :visible="showCreate" @close="showCreate = false" size="lg">
      <CModalHeader><CModalTitle>Nueva aplicación</CModalTitle></CModalHeader>
      <form @submit.prevent="handleCreate">
        <CModalBody>
          <CAlert v-if="formError" color="danger" class="py-2 small">{{ formError }}</CAlert>
          <AppForm :form="form" @update:form="Object.assign(form, $event)" :environments="environments" :servers="servers" :is-create="true" />
        </CModalBody>
        <CModalFooter>
          <CButton color="secondary" variant="outline" @click="showCreate = false" :disabled="saving">Cancelar</CButton>
          <CButton color="primary" type="submit" :disabled="saving">
            <CSpinner v-if="saving" size="sm" />
            <template v-else>Crear</template>
          </CButton>
        </CModalFooter>
      </form>
    </CModal>

    <!-- Modal Editar -->
    <CModal :visible="showEdit" @close="showEdit = false" size="lg">
      <CModalHeader><CModalTitle>Editar aplicación — {{ selected?.code }}</CModalTitle></CModalHeader>
      <form @submit.prevent="handleEdit">
        <CModalBody>
          <CAlert v-if="formError" color="danger" class="py-2 small">{{ formError }}</CAlert>
          <AppForm :form="form" @update:form="Object.assign(form, $event)" :environments="environments" :servers="servers" />
        </CModalBody>
        <CModalFooter>
          <CButton color="secondary" variant="outline" @click="showEdit = false" :disabled="saving">Cancelar</CButton>
          <CButton color="primary" type="submit" :disabled="saving">
            <CSpinner v-if="saving" size="sm" />
            <template v-else>Guardar</template>
          </CButton>
        </CModalFooter>
      </form>
    </CModal>

    <!-- Modal Eliminar -->
    <CModal :visible="showDelete" @close="showDelete = false">
      <CModalHeader><CModalTitle>Eliminar aplicación</CModalTitle></CModalHeader>
      <CModalBody>
        <CAlert v-if="formError" color="danger" class="py-2 small">{{ formError }}</CAlert>
        <p class="mb-1">¿Eliminar la aplicación <strong>{{ selected?.code }} — {{ selected?.name }}</strong>?</p>
        <p class="text-medium-emphasis small mb-0">No es posible si existen credenciales asociadas.</p>
      </CModalBody>
      <CModalFooter>
        <CButton color="secondary" variant="outline" @click="showDelete = false" :disabled="saving">Cancelar</CButton>
        <CButton color="danger" @click="handleDelete" :disabled="saving">
          <CSpinner v-if="saving" size="sm" />
          <template v-else>Eliminar</template>
        </CButton>
      </CModalFooter>
    </CModal>

  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { Pencil, Power, PowerOff, Trash2 } from 'lucide-vue-next'
import api from '../../api/index.js'
import { useAuthStore } from '../../store/authStore.js'
import AppForm from '../../components/resources/AppForm.vue'

const authStore = useAuthStore()
const canWrite  = computed(() => authStore.hasPermission('RES_EDIT'))
const canDelete = computed(() => authStore.hasPermission('RES_DELETE'))

// Solo se enlazan URLs http(s). Vue no sanea el atributo href: una URL
// "javascript:..." guardada en la aplicación se ejecutaría al pulsar el enlace,
// en la sesión de quien lo pulsa. El backend ya rechaza esas URLs al guardar;
// esto cubre las que pudieran existir de antes y cualquier otra vía de entrada.
function esEnlaceSeguro(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url.trim())
}

const APP_TYPES = [
  { value: 'WEB',     label: 'WEB — Aplicación web' },
  { value: 'API',     label: 'API — Servicio REST/SOAP' },
  { value: 'SERVICE', label: 'SERVICE — Servicio de sistema' },
  { value: 'OTHER',   label: 'OTHER — Otro' },
]

const APP_TYPE_COLORS = { WEB: 'primary', API: 'info', SERVICE: 'warning', OTHER: 'secondary' }

// ---------------------------------------------------------------------------
// Estado principal
// ---------------------------------------------------------------------------
const EMPTY_FILTERS = { search: '', env: '', appType: '' }
const EMPTY_FORM    = { name: '', appType: 'WEB', url: '', serverId: '', environmentId: '', description: '' }

const applications = ref([])
const total        = ref(0)
const page         = ref(1)
const filters      = reactive({ ...EMPTY_FILTERS })
const applied      = reactive({ ...EMPTY_FILTERS })
const loading      = ref(true)
const error        = ref(null)
const environments = ref([])
const servers      = ref([])
const showCreate   = ref(false)
const showEdit     = ref(false)
const showDelete   = ref(false)
const selected     = ref(null)
const form         = reactive({ ...EMPTY_FORM })
const formError    = ref(null)
const saving       = ref(false)
const limit        = ref(25)

const totalPages = computed(() => Math.ceil(total.value / limit.value))
const hasFilters = computed(() => Object.values(applied).some(Boolean))

async function load() {
  loading.value = true; error.value = null
  try {
    const params = new URLSearchParams({ page: page.value, limit: limit.value })
    if (applied.search)  params.set('search',        applied.search)
    if (applied.env)     params.set('environmentId', applied.env)
    if (applied.appType) params.set('appType',       applied.appType)
    const data = await api.get(`/applications?${params}`)
    applications.value = data.applications || []
    total.value = data.total || 0
  } catch (err) {
    error.value = err?.message || 'Error al cargar aplicaciones.'
  } finally { loading.value = false }
}

function handleApply() { Object.assign(applied, { ...filters }); page.value = 1 }
function handleReset() { Object.assign(filters, EMPTY_FILTERS); Object.assign(applied, EMPTY_FILTERS); page.value = 1 }
function changePage(p) { page.value = p }

function openCreate() { Object.assign(form, EMPTY_FORM); formError.value = null; showCreate.value = true }

function openEdit(app) {
  selected.value = app
  Object.assign(form, {
    name: app.name, appType: app.app_type,
    url: app.url || '', serverId: app.server_id ? String(app.server_id) : '',
    environmentId: String(app.environment_id), description: app.description || '',
    _code: app.code,
  })
  formError.value = null; showEdit.value = true
}

function openDelete(app) { selected.value = app; formError.value = null; showDelete.value = true }

// form._code solo sirve para mostrar el código en la edición: el backend
// rechaza cualquier campo que no declare su esquema.
function buildPayload() {
  const { _code, ...fields } = form
  return {
    ...fields,
    environmentId: parseInt(form.environmentId),
    serverId: form.serverId ? parseInt(form.serverId) : null,
  }
}

async function handleCreate(e) {
  e.preventDefault(); saving.value = true; formError.value = null
  try {
    await api.post('/applications', buildPayload())
    showCreate.value = false; load()
  } catch (err) { formError.value = err?.message || 'Error al crear.' }
  finally { saving.value = false }
}

async function handleEdit(e) {
  e.preventDefault(); saving.value = true; formError.value = null
  try {
    await api.put(`/applications/${selected.value.id}`, buildPayload())
    showEdit.value = false; load()
  } catch (err) { formError.value = err?.message || 'Error al actualizar.' }
  finally { saving.value = false }
}

async function handleToggle(app) {
  try { await api.patch(`/applications/${app.id}/toggle-estado`); load() }
  catch (err) { error.value = err?.message || 'Error al cambiar estado.' }
}

async function handleDelete() {
  saving.value = true; formError.value = null
  try { await api.delete(`/applications/${selected.value.id}`); showDelete.value = false; load() }
  catch (err) { formError.value = err?.message || 'Error al eliminar.' }
  finally { saving.value = false }
}

function paginationPages(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages = [1]
  if (current > 3) pages.push('...')
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) pages.push(i)
  if (current < total - 2) pages.push('...')
  pages.push(total)
  return pages
}

watch([page, limit, applied], load, { deep: true })

onMounted(async () => {
  load()
  try {
    const data = await api.get('/resources/catalogs')
    environments.value = data.environments || []
    servers.value      = data.servers      || []
  } catch { /* no bloquear */ }
})
</script>
