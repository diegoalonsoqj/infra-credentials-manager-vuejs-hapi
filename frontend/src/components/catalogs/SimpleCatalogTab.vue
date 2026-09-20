<!--
  SimpleCatalogTab.vue — Pestaña CRUD de un catálogo simple (código, nombre,
  orden, estado): SO, productos de servidor/BD y motores de BD.

  Vivía como plantilla en string dentro de CatalogsPage.vue. Eso obligaba a
  compilar la plantilla en el navegador con new Function(), que la CSP del
  backend (script-src 'self', sin unsafe-eval) bloquea: la página entera
  quedaba en blanco en producción. Como SFC, Vite la compila en el build.
-->
<template>
  <div>
    <div v-if="loading" class="d-flex justify-content-center py-4"><CSpinner /></div>
    <CAlert v-else-if="error" color="danger" class="m-3">{{ error }}</CAlert>
    <template v-else>
      <CTable small hover responsive class="mb-0" style="font-size: 13px">
        <CTableHead>
          <CTableRow>
            <CTableHeaderCell>Código</CTableHeaderCell>
            <CTableHeaderCell>Nombre</CTableHeaderCell>
            <CTableHeaderCell>Orden</CTableHeaderCell>
            <CTableHeaderCell>Estado</CTableHeaderCell>
            <CTableHeaderCell>Acciones</CTableHeaderCell>
          </CTableRow>
        </CTableHead>
        <CTableBody>
          <CTableRow v-if="items.length === 0">
            <CTableDataCell :colspan="5" class="text-center text-medium-emphasis py-4">Sin registros. Agrega el primero con el botón +.</CTableDataCell>
          </CTableRow>
          <CTableRow v-for="item in pageItems" :key="item.id">
            <CTableDataCell class="fw-semibold">{{ item.code }}</CTableDataCell>
            <CTableDataCell>{{ item.name }}</CTableDataCell>
            <CTableDataCell class="text-medium-emphasis">{{ item.sort_order ?? 0 }}</CTableDataCell>
            <CTableDataCell>
              <CBadge :color="item.estado === 'AI' ? 'success' : 'secondary'">{{ item.estado === 'AI' ? 'Activo' : 'Inactivo' }}</CBadge>
            </CTableDataCell>
            <CTableDataCell>
              <div class="d-flex gap-1">
                <CButton color="info" size="sm" variant="outline" title="Editar" @click="openEdit(item)"><Pencil :size="13" /></CButton>
                <CButton :color="item.estado === 'AI' ? 'secondary' : 'success'" size="sm" variant="outline"
                  :title="item.estado === 'AI' ? 'Desactivar' : 'Activar'" @click="handleToggle(item)">
                  <Ban v-if="item.estado === 'AI'" :size="13" /><CheckCircle2 v-else :size="13" />
                </CButton>
                <CButton color="danger" size="sm" variant="outline" title="Eliminar" @click="openDelete(item)"><Trash2 :size="13" /></CButton>
              </div>
            </CTableDataCell>
          </CTableRow>
        </CTableBody>
      </CTable>
      <div class="d-flex align-items-center justify-content-between gap-2 px-3 py-2" style="font-size: 13px">
        <div class="d-flex align-items-center gap-2 text-medium-emphasis">
          <span>Mostrar:</span>
          <CFormSelect size="sm" style="width: auto" :model-value="limit" @change="limit = Number($event.target.value); page = 1">
            <option :value="10">10</option><option :value="15">15</option><option :value="25">25</option><option :value="50">50</option>
          </CFormSelect>
          <span>{{ items.length === 0 ? 'Sin registros' : 'Mostrando ' + ((page - 1) * limit + 1) + '–' + Math.min(page * limit, items.length) + ' de ' + items.length }}</span>
        </div>
        <CPagination v-if="totalPages > 1" class="mb-0" size="sm">
          <CPaginationItem :disabled="page <= 1" @click="page > 1 && page--" :style="{ cursor: page > 1 ? 'pointer' : 'default' }">«</CPaginationItem>
          <template v-for="(p, i) in paginationPages(page, totalPages)" :key="i">
            <CPaginationItem v-if="p === '...'" disabled>…</CPaginationItem>
            <CPaginationItem v-else :active="p === page" @click="page = p" style="cursor: pointer">{{ p }}</CPaginationItem>
          </template>
          <CPaginationItem :disabled="page >= totalPages" @click="page < totalPages && page++" :style="{ cursor: page < totalPages ? 'pointer' : 'default' }">»</CPaginationItem>
        </CPagination>
      </div>
    </template>

    <CModal :visible="showCreate" @close="showCreate = false">
      <CModalHeader><CModalTitle>Nuevo {{ singularLabel }}</CModalTitle></CModalHeader>
      <form @submit.prevent="handleCreate">
        <CModalBody>
          <CAlert v-if="formError" color="danger" class="py-2 small">{{ formError }}</CAlert>
          <CRow class="g-3">
            <CCol :md="8"><CFormLabel class="small fw-semibold">Nombre *</CFormLabel>
              <CFormInput size="sm" placeholder="ej: Linux" v-model="form.name" required /></CCol>
            <CCol :md="4">
              <CFormLabel class="small fw-semibold">Orden</CFormLabel>
              <CFormInput size="sm" type="number" :min="0" v-model.number="form.sortOrder" />
              <div class="text-medium-emphasis" style="font-size: 11px; margin-top: 2px">Posición en selects</div>
            </CCol>
          </CRow>
        </CModalBody>
        <CModalFooter>
          <CButton color="secondary" variant="outline" @click="showCreate = false" :disabled="saving">Cancelar</CButton>
          <CButton color="primary" type="submit" :disabled="saving"><CSpinner v-if="saving" size="sm" /><template v-else>Crear</template></CButton>
        </CModalFooter>
      </form>
    </CModal>

    <CModal :visible="showEdit" @close="showEdit = false">
      <CModalHeader><CModalTitle>Editar {{ singularLabel }} — {{ selected?.code }}</CModalTitle></CModalHeader>
      <form @submit.prevent="handleEdit">
        <CModalBody>
          <CAlert v-if="formError" color="danger" class="py-2 small">{{ formError }}</CAlert>
          <CRow class="g-3">
            <CCol :md="4"><CFormLabel class="small fw-semibold text-medium-emphasis">Código (sistema)</CFormLabel>
              <CFormInput size="sm" :value="selected?.code || ''" disabled style="background: var(--cui-tertiary-bg); font-family: monospace" /></CCol>
            <CCol :md="4"><CFormLabel class="small fw-semibold">Nombre *</CFormLabel>
              <CFormInput size="sm" v-model="form.name" required /></CCol>
            <CCol :md="4"><CFormLabel class="small fw-semibold">Orden</CFormLabel>
              <CFormInput size="sm" type="number" :min="0" v-model.number="form.sortOrder" /></CCol>
          </CRow>
        </CModalBody>
        <CModalFooter>
          <CButton color="secondary" variant="outline" @click="showEdit = false" :disabled="saving">Cancelar</CButton>
          <CButton color="primary" type="submit" :disabled="saving"><CSpinner v-if="saving" size="sm" /><template v-else>Guardar</template></CButton>
        </CModalFooter>
      </form>
    </CModal>

    <CModal :visible="showDelete" @close="showDelete = false">
      <CModalHeader><CModalTitle>Eliminar {{ singularLabel }}</CModalTitle></CModalHeader>
      <CModalBody>
        <CAlert v-if="formError" color="danger" class="py-2 small">{{ formError }}</CAlert>
        <p class="mb-1">¿Eliminar <strong>{{ selected?.code }} — {{ selected?.name }}</strong>?</p>
        <p class="text-medium-emphasis small mb-0">No es posible si hay recursos que lo referencian.</p>
      </CModalBody>
      <CModalFooter>
        <CButton color="secondary" variant="outline" @click="showDelete = false" :disabled="saving">Cancelar</CButton>
        <CButton color="danger" @click="handleDelete" :disabled="saving"><CSpinner v-if="saving" size="sm" /><template v-else>Eliminar</template></CButton>
      </CModalFooter>
    </CModal>
  </div>
</template>

<script>
import { ref, reactive, computed, onMounted, defineComponent } from 'vue'
import { Pencil, Trash2, Ban, CheckCircle2 } from 'lucide-vue-next'
import api from '../../api/index.js'

export default defineComponent({
  name: 'SimpleCatalogTab',
  components: { Pencil, Trash2, Ban, CheckCircle2 },
  props: {
    apiPrefix:     { type: String, required: true },
    singularLabel: { type: String, required: true },
  },
  setup(props, { expose }) {
    const items      = ref([])
    const loading    = ref(true)
    const error      = ref(null)
    const showCreate = ref(false)
    const showEdit   = ref(false)
    const showDelete = ref(false)
    const selected   = ref(null)
    const form       = reactive({ name: '', sortOrder: 0 })
    const formError  = ref(null)
    const saving     = ref(false)
    const page       = ref(1)
    const limit      = ref(15)

    const totalPages = computed(() => Math.ceil(items.value.length / limit.value) || 1)
    const pageItems  = computed(() => items.value.slice((page.value - 1) * limit.value, page.value * limit.value))

    async function load() {
      loading.value = true; error.value = null
      try { const data = await api.get(props.apiPrefix); items.value = data.items || [] }
      catch (err) { error.value = err?.message || 'Error al cargar.' }
      finally { loading.value = false }
    }

    function openCreate() { form.name = ''; form.sortOrder = 0; formError.value = null; showCreate.value = true }
    expose({ openCreate })

    function openEdit(item) {
      selected.value = item; form.name = item.name; form.sortOrder = item.sort_order ?? 0
      formError.value = null; showEdit.value = true
    }
    function openDelete(item) { selected.value = item; formError.value = null; showDelete.value = true }

    async function handleCreate() {
      saving.value = true; formError.value = null
      try { await api.post(props.apiPrefix, { ...form }); showCreate.value = false; load() }
      catch (err) { formError.value = err?.message || 'Error al crear.' }
      finally { saving.value = false }
    }
    async function handleEdit() {
      saving.value = true; formError.value = null
      try { await api.put(`${props.apiPrefix}/${selected.value.id}`, { ...form }); showEdit.value = false; load() }
      catch (err) { formError.value = err?.message || 'Error al actualizar.' }
      finally { saving.value = false }
    }
    async function handleToggle(item) {
      try { await api.patch(`${props.apiPrefix}/${item.id}/toggle-estado`); load() }
      catch (err) { error.value = err?.message || 'Error al cambiar estado.' }
    }
    async function handleDelete() {
      saving.value = true; formError.value = null
      try { await api.delete(`${props.apiPrefix}/${selected.value.id}`); showDelete.value = false; load() }
      catch (err) { formError.value = err?.message || 'Error al eliminar.' }
      finally { saving.value = false }
    }

    function paginationPages(cur, tot) {
      if (tot <= 7) return Array.from({ length: tot }, (_, i) => i + 1)
      const pages = [1]
      if (cur > 3) pages.push('...')
      for (let i = Math.max(2, cur - 1); i <= Math.min(tot - 1, cur + 1); i++) pages.push(i)
      if (cur < tot - 2) pages.push('...')
      pages.push(tot)
      return pages
    }

    onMounted(load)

    return {
      items, loading, error, showCreate, showEdit, showDelete, selected, form, formError, saving,
      page, limit, totalPages, pageItems, openCreate, openEdit, openDelete,
      handleCreate, handleEdit, handleToggle, handleDelete, paginationPages,
    }
  },
})
</script>
