<template>
  <div style="display: flex; flex-direction: column; height: 100%; overflow: hidden">

    <!-- Toast -->
    <CAlert v-if="toast" :color="toast.color" class="position-fixed top-0 end-0 m-3 shadow"
      style="z-index: 9999; min-width: 280px">{{ toast.msg }}</CAlert>

    <!-- Header + Filtros -->
    <div style="flex-shrink: 0; padding: 0.75rem 1.5rem 0.5rem">
      <div v-if="canWrite" class="d-flex justify-content-end mb-2">
        <CButton color="primary" size="sm" @click="openModal('create')">+ Nuevo servidor</CButton>
      </div>
      <CCard class="shadow-sm">
        <CCardBody class="py-2">
          <form @submit.prevent="handleApply">
            <div class="d-flex gap-2 align-items-center">
              <CFormInput size="sm" placeholder="Buscar código, hostname, nombre..."
                v-model="filters.search" style="flex: 1; min-width: 120px" />
              <CFormSelect size="sm" v-model="filters.env" style="width: 130px">
                <option value="" disabled hidden>Ambiente</option>
                <option value="">Todos los ambientes</option>
                <option v-for="e in catalogs.environments" :key="e.id" :value="String(e.id)">{{ e.name }} ({{ e.code }})</option>
              </CFormSelect>
              <CFormSelect size="sm" v-model="filters.infra" style="width: 120px">
                <option value="" disabled hidden>Infraestr.</option>
                <option value="">Todas</option>
                <option v-for="i in catalogs.infrastructures" :key="i.id" :value="String(i.id)">{{ i.name }}</option>
              </CFormSelect>
              <CFormSelect size="sm" v-model="filters.product" style="width: 120px">
                <option value="" disabled hidden>Plataforma</option>
                <option value="">Todas</option>
                <option v-for="p in catalogs.serverProducts" :key="p.id" :value="String(p.id)">{{ p.name }}</option>
              </CFormSelect>
              <CFormSelect size="sm" v-model="filters.os" style="width: 120px">
                <option value="" disabled hidden>Sistema Op.</option>
                <option value="">Todos</option>
                <option v-for="o in catalogs.osTypes" :key="o.id" :value="String(o.id)">{{ o.name }}</option>
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
          <div v-if="loading" class="d-flex justify-content-center py-5">
            <CSpinner color="primary" />
          </div>
          <CAlert v-else-if="error" color="danger" class="m-3">{{ error }}</CAlert>
          <div v-else style="flex: 1; overflow-y: auto">
            <CTable hover class="mb-0 table-sticky-head" style="font-size: 13px">
              <CTableHead>
                <CTableRow>
                  <CTableHeaderCell>Código</CTableHeaderCell>
                  <CTableHeaderCell>Hostname / Nombre</CTableHeaderCell>
                  <CTableHeaderCell>IP</CTableHeaderCell>
                  <CTableHeaderCell>Ambiente</CTableHeaderCell>
                  <CTableHeaderCell>OS / Plataforma</CTableHeaderCell>
                  <CTableHeaderCell>Estado</CTableHeaderCell>
                  <CTableHeaderCell class="text-end">Acciones</CTableHeaderCell>
                </CTableRow>
              </CTableHead>
              <CTableBody>
                <CTableRow v-if="servers.length === 0">
                  <CTableDataCell :colspan="7" class="text-center text-medium-emphasis py-4">
                    No se encontraron servidores.
                  </CTableDataCell>
                </CTableRow>
                <CTableRow v-for="srv in servers" :key="srv.id">
                  <CTableDataCell>
                    <span class="fw-semibold font-monospace">{{ srv.code }}</span>
                  </CTableDataCell>
                  <CTableDataCell>
                    <div class="fw-medium font-monospace" style="font-size: 12px">{{ srv.hostname }}</div>
                    <div class="text-medium-emphasis" style="font-size: 11px">{{ srv.name }}</div>
                  </CTableDataCell>
                  <CTableDataCell>
                    <span v-if="srv.ip_address" class="font-monospace" style="font-size: 12px">{{ srv.ip_address }}</span>
                    <span v-else class="text-medium-emphasis">—</span>
                  </CTableDataCell>
                  <CTableDataCell>
                    <CBadge :color="srv.prd_flag ? 'danger' : 'secondary'">{{ srv.environment_name }}</CBadge>
                    <div v-if="srv.project_name" class="text-medium-emphasis" style="font-size: 11px; margin-top: 2px">
                      {{ srv.project_name }}
                    </div>
                  </CTableDataCell>
                  <CTableDataCell>
                    <div style="font-size: 12px">
                      <CBadge v-if="srv.os_name" color="light" text-color="dark" class="me-1">{{ srv.os_name }}</CBadge>
                      <CBadge v-if="srv.product_name" color="info">{{ srv.product_name }}</CBadge>
                      <span v-if="!srv.os_name && !srv.product_name" class="text-medium-emphasis">—</span>
                    </div>
                  </CTableDataCell>
                  <CTableDataCell>
                    <CBadge :color="ESTADO_COLOR[srv.estado]">{{ ESTADO_LABEL[srv.estado] }}</CBadge>
                  </CTableDataCell>
                  <CTableDataCell class="text-end">
                    <div v-if="canWrite" class="d-flex gap-1 justify-content-end">
                      <CButton size="sm" color="secondary" variant="outline" title="Editar"
                        @click="openModal('edit', srv)">
                        <Pencil :size="13" />
                      </CButton>
                      <CButton size="sm" :color="srv.estado === 'AI' ? 'warning' : 'success'"
                        variant="outline" :title="srv.estado === 'AI' ? 'Desactivar' : 'Activar'"
                        @click="handleToggle(srv)">
                        <PowerOff v-if="srv.estado === 'AI'" :size="13" />
                        <Power v-else :size="13" />
                      </CButton>
                      <CButton size="sm" color="danger" variant="outline" title="Eliminar"
                        @click="openModal('delete', srv)">
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
    <CModal :visible="modal === 'create'" @close="closeModal" size="lg">
      <CModalHeader><CModalTitle>Nuevo servidor</CModalTitle></CModalHeader>
      <CModalBody>
        <ServerForm :catalogs="catalogs" @save="handleCreate" @cancel="closeModal"
          :loading="modalLoading" :error="modalError" />
      </CModalBody>
    </CModal>

    <!-- Modal Editar -->
    <CModal :visible="modal === 'edit'" @close="closeModal" size="lg">
      <CModalHeader>
        <CModalTitle>Editar — <span class="font-monospace">{{ selectedItem?.code }}</span></CModalTitle>
      </CModalHeader>
      <CModalBody>
        <ServerForm v-if="selectedItem" :initial="selectedItem" :catalogs="catalogs"
          @save="handleUpdate" @cancel="closeModal" :loading="modalLoading" :error="modalError" />
      </CModalBody>
    </CModal>

    <!-- Modal Eliminar -->
    <CModal :visible="modal === 'delete'" @close="closeModal">
      <CModalHeader><CModalTitle class="text-danger">Eliminar servidor</CModalTitle></CModalHeader>
      <CModalBody>
        <CAlert v-if="modalError" color="danger" class="py-2 small">{{ modalError }}</CAlert>
        <p>¿Eliminar el servidor <strong class="font-monospace">{{ selectedItem?.code }}</strong>?</p>
        <p class="text-medium-emphasis small mb-0">
          Solo se puede eliminar si no tiene credenciales activas. Eliminación lógica (soft delete).
        </p>
      </CModalBody>
      <CModalFooter>
        <CButton color="secondary" variant="outline" @click="closeModal">Cancelar</CButton>
        <CButton color="danger" @click="handleDelete" :disabled="modalLoading">
          <CSpinner v-if="modalLoading" size="sm" class="me-2" />
          <template v-if="!modalLoading">Confirmar eliminación</template>
          <template v-else>Eliminando...</template>
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
import ServerForm from '../../components/resources/ServerForm.vue'

const authStore = useAuthStore()
const canWrite  = computed(() => authStore.hasPermission('RES_EDIT'))

const ESTADO_COLOR = { AI: 'success', IN: 'secondary' }
const ESTADO_LABEL = { AI: 'Activo',  IN: 'Inactivo'  }

// ---------------------------------------------------------------------------
// Estado principal
// ---------------------------------------------------------------------------
const EMPTY_FILTERS = { search: '', env: '', infra: '', product: '', os: '' }

const servers      = ref([])
const total        = ref(0)
const page         = ref(1)
const filters      = reactive({ ...EMPTY_FILTERS })
const applied      = reactive({ ...EMPTY_FILTERS })
const loading      = ref(true)
const error        = ref(null)
const toast        = ref(null)
const catalogs     = reactive({ environments: [], infrastructures: [], osTypes: [], serverProducts: [], projects: [] })
const modal        = ref(null)
const selectedItem = ref(null)
const modalLoading = ref(false)
const modalError   = ref(null)
const limit        = ref(25)

const totalPages = computed(() => Math.ceil(total.value / limit.value))
const hasFilters = computed(() => Object.values(applied).some(Boolean))

function showToast(msg, color = 'success') {
  toast.value = { msg, color }
  setTimeout(() => { toast.value = null }, 3500)
}

async function loadServers() {
  loading.value = true; error.value = null
  try {
    const params = new URLSearchParams({ page: page.value, limit: limit.value })
    if (applied.search)  params.set('search',          applied.search)
    if (applied.env)     params.set('environmentId',   applied.env)
    if (applied.infra)   params.set('infrastructureId',applied.infra)
    if (applied.product) params.set('productId',       applied.product)
    if (applied.os)      params.set('osId',            applied.os)
    const data = await api.get(`/resources/servers?${params}`)
    servers.value = data.servers; total.value = data.total
  } catch (err) {
    error.value = err.message || 'Error al cargar servidores.'
  } finally { loading.value = false }
}

function handleApply() { Object.assign(applied, { ...filters }); page.value = 1 }
function handleReset() { Object.assign(filters, EMPTY_FILTERS); Object.assign(applied, EMPTY_FILTERS); page.value = 1 }
function changePage(p) { page.value = p }

function openModal(type, item = null) { selectedItem.value = item; modal.value = type; modalError.value = null }
function closeModal() { modal.value = null; selectedItem.value = null; modalError.value = null }

async function handleCreate(form) {
  modalLoading.value = true; modalError.value = null
  try {
    await api.post('/resources/servers', {
      hostname: form.hostname, name: form.name,
      ipAddress: form.ipAddress || undefined,
      environmentId: parseInt(form.environmentId),
      infrastructureId: form.infrastructureId ? parseInt(form.infrastructureId) : undefined,
      projectId: form.projectId ? parseInt(form.projectId) : undefined,
      productId: form.productId ? parseInt(form.productId) : undefined,
      osId: form.osId ? parseInt(form.osId) : undefined,
      description: form.description || undefined,
    })
    closeModal(); loadServers()
    showToast(`Servidor '${form.name}' creado.`)
  } catch (err) {
    modalError.value = err.message || 'Error al crear servidor.'
  } finally { modalLoading.value = false }
}

async function handleUpdate(form) {
  modalLoading.value = true; modalError.value = null
  try {
    await api.put(`/resources/servers/${selectedItem.value.id}`, {
      hostname: form.hostname, name: form.name,
      ipAddress: form.ipAddress || undefined,
      environmentId: parseInt(form.environmentId),
      infrastructureId: form.infrastructureId ? parseInt(form.infrastructureId) : undefined,
      projectId: form.projectId ? parseInt(form.projectId) : undefined,
      productId: form.productId ? parseInt(form.productId) : undefined,
      osId: form.osId ? parseInt(form.osId) : undefined,
      description: form.description || undefined,
    })
    closeModal(); loadServers()
    showToast('Servidor actualizado.')
  } catch (err) {
    modalError.value = err.message || 'Error al actualizar servidor.'
  } finally { modalLoading.value = false }
}

async function handleToggle(srv) {
  try {
    await api.patch(`/resources/servers/${srv.id}/toggle-estado`)
    loadServers()
    showToast(`Servidor '${srv.code}' ${srv.estado === 'AI' ? 'desactivado' : 'activado'}.`)
  } catch (err) { showToast(err.message || 'Error.', 'danger') }
}

async function handleDelete() {
  modalLoading.value = true
  try {
    await api.delete(`/resources/servers/${selectedItem.value.id}`)
    closeModal(); loadServers()
    showToast(`Servidor '${selectedItem.value.code}' eliminado.`)
  } catch (err) {
    modalError.value = err.message || 'Error al eliminar.'
  } finally { modalLoading.value = false }
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

watch([page, limit, applied], loadServers, { deep: true })

onMounted(() => {
  loadServers()
  api.get('/resources/catalogs')
    .then(data => {
      catalogs.environments    = data.environments    || []
      catalogs.infrastructures = data.infrastructures || []
      catalogs.osTypes         = data.osTypes         || []
      catalogs.serverProducts  = data.serverProducts  || []
      catalogs.projects        = data.projects        || []
    })
    .catch(() => {})
})
</script>
