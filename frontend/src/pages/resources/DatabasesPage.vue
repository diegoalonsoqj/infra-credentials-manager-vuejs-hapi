<template>
  <div style="display: flex; flex-direction: column; height: 100%; overflow: hidden">

    <!-- Toast -->
    <CAlert v-if="toast" :color="toast.color" class="position-fixed top-0 end-0 m-3 shadow"
      style="z-index: 9999; min-width: 280px">{{ toast.msg }}</CAlert>

    <!-- Header + Filtros -->
    <div style="flex-shrink: 0; padding: 0.75rem 1.5rem 0.5rem">
      <div v-if="canWrite" class="d-flex justify-content-end mb-2">
        <CButton color="primary" size="sm" @click="openModal('create')">+ Nuevo servicio de BD</CButton>
      </div>
      <CCard class="shadow-sm">
        <CCardBody class="py-2">
          <form @submit.prevent="handleApply">
            <div class="d-flex gap-2 align-items-center flex-wrap">
              <CFormInput size="sm" placeholder="Buscar código, nombre, host..."
                v-model="filters.search" style="flex: 1; min-width: 120px" />
              <CFormSelect size="sm" v-model="filters.env" style="width: 130px">
                <option value="" disabled hidden>Ambiente</option>
                <option value="">Todos los ambientes</option>
                <option v-for="e in catalogs.environments" :key="e.id" :value="String(e.id)">{{ e.name }}</option>
              </CFormSelect>
              <CFormSelect size="sm" v-model="filters.engine" style="width: 120px">
                <option value="" disabled hidden>Motor</option>
                <option value="">Todos</option>
                <option v-for="e in catalogs.dbEngines" :key="e.id" :value="String(e.id)">{{ e.name }}</option>
              </CFormSelect>
              <CFormSelect size="sm" v-model="filters.product" style="width: 120px">
                <option value="" disabled hidden>Producto</option>
                <option value="">Todos</option>
                <option v-for="p in catalogs.dbProducts" :key="p.id" :value="String(p.id)">{{ p.name }}</option>
              </CFormSelect>
              <CFormSelect size="sm" v-model="filters.infra" style="width: 120px">
                <option value="" disabled hidden>Infraestr.</option>
                <option value="">Todas</option>
                <option v-for="i in catalogs.infrastructures" :key="i.id" :value="String(i.id)">{{ i.name }}</option>
              </CFormSelect>
              <CFormSelect size="sm" v-model="filters.estado" style="width: 100px">
                <option value="" disabled hidden>Estado</option>
                <option value="">Todos</option>
                <option value="AI">Activo</option>
                <option value="IN">Inactivo</option>
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
            <CTable hover class="mb-0" style="font-size: 13px">
              <CTableHead>
                <CTableRow>
                  <CTableHeaderCell>Código</CTableHeaderCell>
                  <CTableHeaderCell>Nombre / Host</CTableHeaderCell>
                  <CTableHeaderCell>Motor</CTableHeaderCell>
                  <CTableHeaderCell>Ambiente</CTableHeaderCell>
                  <CTableHeaderCell>Servidor host</CTableHeaderCell>
                  <CTableHeaderCell>Estado</CTableHeaderCell>
                  <CTableHeaderCell class="text-end">Acciones</CTableHeaderCell>
                </CTableRow>
              </CTableHead>
              <CTableBody>
                <CTableRow v-if="dbServices.length === 0">
                  <CTableDataCell :colspan="7" class="text-center text-medium-emphasis py-4">
                    No se encontraron servicios de BD.
                  </CTableDataCell>
                </CTableRow>
                <CTableRow v-for="svc in dbServices" :key="svc.id">
                  <CTableDataCell>
                    <span class="fw-semibold font-monospace">{{ svc.code }}</span>
                  </CTableDataCell>
                  <CTableDataCell>
                    <div class="fw-medium">{{ svc.name }}</div>
                    <div class="font-monospace text-medium-emphasis" style="font-size: 11px">
                      {{ svc.host }}{{ svc.port ? `:${svc.port}` : '' }}
                    </div>
                  </CTableDataCell>
                  <CTableDataCell>
                    <CBadge v-if="svc.engine_name" color="info" class="me-1">{{ svc.engine_name }}</CBadge>
                    <CBadge v-if="svc.product_name" color="light" text-color="dark">{{ svc.product_name }}</CBadge>
                    <span v-if="!svc.engine_name && !svc.product_name" class="text-medium-emphasis">—</span>
                  </CTableDataCell>
                  <CTableDataCell>
                    <CBadge :color="svc.prd_flag ? 'danger' : 'secondary'">{{ svc.environment_name }}</CBadge>
                    <div v-if="svc.project_name" class="text-medium-emphasis"
                      style="font-size: 11px; margin-top: 2px">{{ svc.project_name }}</div>
                  </CTableDataCell>
                  <CTableDataCell>
                    <template v-if="svc.server_name">
                      <span class="font-monospace" style="font-size: 12px">{{ svc.server_code }}</span>
                      <div class="text-medium-emphasis" style="font-size: 11px">{{ svc.server_hostname }}</div>
                    </template>
                    <span v-else class="text-medium-emphasis small">Cloud / SaaS</span>
                  </CTableDataCell>
                  <CTableDataCell>
                    <CBadge :color="ESTADO_COLOR[svc.estado]">{{ ESTADO_LABEL[svc.estado] }}</CBadge>
                  </CTableDataCell>
                  <CTableDataCell class="text-end">
                    <div v-if="canWrite" class="d-flex gap-1 justify-content-end">
                      <CButton size="sm" color="secondary" variant="outline" title="Editar"
                        @click="openModal('edit', svc)">
                        <Pencil :size="13" />
                      </CButton>
                      <CButton size="sm" :color="svc.estado === 'AI' ? 'warning' : 'success'"
                        variant="outline" :title="svc.estado === 'AI' ? 'Desactivar' : 'Activar'"
                        @click="handleToggle(svc)">
                        <PowerOff v-if="svc.estado === 'AI'" :size="13" />
                        <Power v-else :size="13" />
                      </CButton>
                      <CButton size="sm" color="danger" variant="outline" title="Eliminar"
                        @click="openModal('delete', svc)">
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
      <CModalHeader><CModalTitle>Nuevo servicio de BD</CModalTitle></CModalHeader>
      <CModalBody>
        <DbServiceForm :catalogs="catalogs" @save="handleCreate" @cancel="closeModal"
          :loading="modalLoading" :error="modalError" />
      </CModalBody>
    </CModal>

    <!-- Modal Editar -->
    <CModal :visible="modal === 'edit'" @close="closeModal" size="lg">
      <CModalHeader>
        <CModalTitle>Editar — <span class="font-monospace">{{ selectedItem?.code }}</span></CModalTitle>
      </CModalHeader>
      <CModalBody>
        <DbServiceForm v-if="selectedItem" :initial="selectedItem" :catalogs="catalogs"
          @save="handleUpdate" @cancel="closeModal" :loading="modalLoading" :error="modalError" />
      </CModalBody>
    </CModal>

    <!-- Modal Eliminar -->
    <CModal :visible="modal === 'delete'" @close="closeModal">
      <CModalHeader><CModalTitle class="text-danger">Eliminar servicio de BD</CModalTitle></CModalHeader>
      <CModalBody>
        <CAlert v-if="modalError" color="danger" class="py-2 small">{{ modalError }}</CAlert>
        <p>¿Eliminar el servicio <strong class="font-monospace">{{ selectedItem?.code }}</strong>?</p>
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
import DbServiceForm from '../../components/resources/DbServiceForm.vue'

const authStore = useAuthStore()
const canWrite  = computed(() => authStore.hasPermission('RES_EDIT'))

const ESTADO_COLOR = { AI: 'success', IN: 'secondary' }
const ESTADO_LABEL = { AI: 'Activo',  IN: 'Inactivo'  }

// ---------------------------------------------------------------------------
// Estado principal
// ---------------------------------------------------------------------------
const EMPTY_FILTERS = { search: '', env: '', engine: '', estado: '', product: '', infra: '' }

const dbServices   = ref([])
const total        = ref(0)
const page         = ref(1)
const limit        = ref(25)
const loading      = ref(true)
const error        = ref(null)
const toast        = ref(null)
const filters      = reactive({ ...EMPTY_FILTERS })
const applied      = reactive({ ...EMPTY_FILTERS })
const catalogs     = reactive({
  environments: [], infrastructures: [], dbProducts: [], dbEngines: [], servers: [], projects: [],
})
const modal        = ref(null)
const selectedItem = ref(null)
const modalLoading = ref(false)
const modalError   = ref(null)

const totalPages = computed(() => Math.ceil(total.value / limit.value) || 1)
const hasFilters = computed(() => Object.values(applied).some(Boolean))

function showToast(msg, color = 'success') {
  toast.value = { msg, color }
  setTimeout(() => { toast.value = null }, 3500)
}

async function loadDbServices() {
  loading.value = true; error.value = null
  try {
    const params = new URLSearchParams({ page: page.value, limit: limit.value })
    if (applied.search)  params.set('search',           applied.search)
    if (applied.env)     params.set('environmentId',    applied.env)
    if (applied.engine)  params.set('engineId',         applied.engine)
    if (applied.estado)  params.set('estado',           applied.estado)
    if (applied.product) params.set('productId',        applied.product)
    if (applied.infra)   params.set('infrastructureId', applied.infra)
    const data = await api.get(`/resources/db-services?${params}`)
    dbServices.value = data.dbServices || []
    total.value      = data.total      || 0
  } catch (err) {
    error.value = err?.message || 'Error al cargar servicios de BD.'
  } finally {
    loading.value = false
  }
}

function handleApply() {
  Object.assign(applied, { ...filters })
  page.value = 1
  loadDbServices()
}

function handleReset() {
  Object.assign(filters, { ...EMPTY_FILTERS })
  Object.assign(applied, { ...EMPTY_FILTERS })
  page.value = 1
  loadDbServices()
}

function changePage(p) {
  page.value = p
  loadDbServices()
}

function openModal(type, item = null) {
  selectedItem.value = item
  modal.value        = type
  modalError.value   = null
}

function closeModal() {
  modal.value        = null
  selectedItem.value = null
  modalError.value   = null
}

function buildPayload(form) {
  return {
    name:             form.name,
    host:             form.host,
    port:             form.port ? parseInt(form.port) : undefined,
    environmentId:    parseInt(form.environmentId),
    infrastructureId: form.infrastructureId  ? parseInt(form.infrastructureId)  : undefined,
    projectId:        form.projectId         ? parseInt(form.projectId)         : undefined,
    productId:        form.productId         ? parseInt(form.productId)         : undefined,
    engineId:         form.engineId          ? parseInt(form.engineId)          : undefined,
    serverId:         form.serverId          ? parseInt(form.serverId)          : undefined,
    description:      form.description       || undefined,
  }
}

async function handleCreate(form) {
  modalLoading.value = true; modalError.value = null
  try {
    await api.post('/resources/db-services', buildPayload(form))
    closeModal()
    loadDbServices()
    showToast(`Servicio '${form.name}' creado.`)
  } catch (err) {
    modalError.value = err?.message || 'Error al crear.'
  } finally {
    modalLoading.value = false
  }
}

async function handleUpdate(form) {
  modalLoading.value = true; modalError.value = null
  try {
    await api.put(`/resources/db-services/${selectedItem.value.id}`, buildPayload(form))
    closeModal()
    loadDbServices()
    showToast('Servicio actualizado.')
  } catch (err) {
    modalError.value = err?.message || 'Error al actualizar.'
  } finally {
    modalLoading.value = false
  }
}

async function handleToggle(svc) {
  try {
    await api.patch(`/resources/db-services/${svc.id}/toggle-estado`)
    loadDbServices()
    showToast(`Servicio '${svc.code}' ${svc.estado === 'AI' ? 'desactivado' : 'activado'}.`)
  } catch (err) {
    showToast(err?.message || 'Error.', 'danger')
  }
}

async function handleDelete() {
  modalLoading.value = true
  try {
    await api.delete(`/resources/db-services/${selectedItem.value.id}`)
    closeModal()
    loadDbServices()
    showToast(`Servicio '${selectedItem.value?.code}' eliminado.`)
  } catch (err) {
    modalError.value = err?.message || 'Error al eliminar.'
  } finally {
    modalLoading.value = false
  }
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

watch(page, loadDbServices)

onMounted(() => {
  loadDbServices()
  api.get('/resources/catalogs')
    .then(data => {
      catalogs.environments    = data.environments    || []
      catalogs.infrastructures = data.infrastructures || []
      catalogs.dbProducts      = data.dbProducts      || []
      catalogs.dbEngines       = data.dbEngines       || []
      catalogs.servers         = data.servers         || []
      catalogs.projects        = data.projects        || []
    })
    .catch(() => {})
})
</script>
