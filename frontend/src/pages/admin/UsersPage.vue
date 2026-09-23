<template>
  <div style="display: flex; flex-direction: column; height: 100%; overflow: hidden">

    <!-- Toast -->
    <CAlert v-if="toast" :color="toast.color"
      class="position-fixed top-0 end-0 m-3 shadow"
      style="z-index: 9999; min-width: 280px">
      {{ toast.msg }}
    </CAlert>

    <!-- Header + Filtros -->
    <div style="flex-shrink: 0; padding: 1rem 1.5rem 0.75rem">
      <div class="d-flex justify-content-end mb-2">
        <CButton color="primary" @click="openModal('create')">+ Nuevo usuario</CButton>
      </div>
      <CCard class="shadow-sm mb-0">
        <CCardBody class="py-2 px-3">
          <form class="d-flex flex-wrap align-items-center gap-2" @submit.prevent="applyFilters">
            <CFormInput size="sm" placeholder="Buscar por nombre, username o email..."
              v-model="filters.search" style="flex: 1; min-width: 220px" />
            <CFormSelect size="sm" v-model="filters.role" style="width: 130px">
              <option value="" disabled hidden>Rol</option>
              <option value="">Todos los roles</option>
              <option v-for="r in roles" :key="r.code" :value="r.code">{{ r.name }}</option>
            </CFormSelect>
            <CFormSelect size="sm" v-model="filters.team" style="width: 130px">
              <option value="" disabled hidden>Equipo</option>
              <option value="">Todos los equipos</option>
              <option v-for="t in teams" :key="t.code" :value="t.code">{{ t.name }}</option>
            </CFormSelect>
            <CFormSelect size="sm" v-model="filters.estado" style="width: 110px">
              <option value="" disabled hidden>Estado</option>
              <option value="">Todos</option>
              <option value="AI">Activo</option>
              <option value="IN">Inactivo</option>
            </CFormSelect>
            <CButton type="submit" color="primary" size="sm">Buscar</CButton>
            <CButton v-if="hasFilters" type="button" color="secondary" variant="outline" size="sm"
              @click="resetFilters">✕</CButton>
          </form>
        </CCardBody>
      </CCard>
    </div>

    <!-- Tabla -->
    <div style="flex: 1; min-height: 0; padding: 0 1.5rem; display: flex; flex-direction: column">
      <CCard class="shadow-sm"
        style="flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden">
        <CCardBody style="padding: 0; flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden">
          <div v-if="loading" class="d-flex justify-content-center py-5">
            <CSpinner color="primary" />
          </div>
          <CAlert v-else-if="error" color="danger" class="m-3">{{ error }}</CAlert>
          <div v-else style="flex: 1; overflow-y: auto">
            <CTable hover class="mb-0" style="font-size: 13px">
              <CTableHead>
                <CTableRow>
                  <CTableHeaderCell>Usuario</CTableHeaderCell>
                  <CTableHeaderCell>Email</CTableHeaderCell>
                  <CTableHeaderCell>Rol</CTableHeaderCell>
                  <CTableHeaderCell>Equipo</CTableHeaderCell>
                  <CTableHeaderCell>Estado</CTableHeaderCell>
                  <CTableHeaderCell>Último login</CTableHeaderCell>
                  <CTableHeaderCell class="text-end">Acciones</CTableHeaderCell>
                </CTableRow>
              </CTableHead>
              <CTableBody>
                <CTableRow v-if="users.length === 0">
                  <CTableDataCell :colspan="7" class="text-center text-medium-emphasis py-4">
                    No se encontraron usuarios.
                  </CTableDataCell>
                </CTableRow>
                <CTableRow v-for="u in users" :key="u.id">
                  <CTableDataCell>
                    <div class="fw-medium d-flex align-items-center gap-2">
                      {{ u.username }}
                      <ShieldCheck v-if="u.mfa_enabled" :size="13" class="text-success" title="Segundo factor activado" />
                      <CBadge v-if="u.auth_source === 'LDAP'" color="info" style="font-size: 10px"
                        title="Entra con su contraseña de dominio">LDAP</CBadge>
                    </div>
                    <div class="text-medium-emphasis" style="font-size: 11px">{{ u.first_name }} {{ u.last_name }}</div>
                    <CBadge v-if="u.locked_until && new Date(u.locked_until) > new Date()"
                      color="danger" style="font-size: 10px">
                      <Lock :size="11" class="me-1" /> Bloqueado
                    </CBadge>
                  </CTableDataCell>
                  <CTableDataCell class="text-medium-emphasis">{{ u.email }}</CTableDataCell>
                  <CTableDataCell>
                    <CBadge :color="ROLE_COLORS[u.role] || 'secondary'">{{ u.role }}</CBadge>
                  </CTableDataCell>
                  <CTableDataCell>
                    <CBadge v-if="u.team" color="secondary">{{ u.team }}</CBadge>
                    <span v-else class="text-medium-emphasis">—</span>
                  </CTableDataCell>
                  <CTableDataCell>
                    <CBadge :color="ESTADO_COLOR[u.estado]">{{ ESTADO_LABEL[u.estado] }}</CBadge>
                  </CTableDataCell>
                  <CTableDataCell class="text-medium-emphasis">
                    {{ u.last_login_at ? new Date(u.last_login_at).toLocaleString('es-PE') : 'Nunca' }}
                  </CTableDataCell>
                  <CTableDataCell class="text-end">
                    <div class="d-flex gap-1 justify-content-end">
                      <CButton size="sm" color="secondary" variant="outline" title="Editar" @click="openModal('edit', u)">
                        <Pencil :size="13" />
                      </CButton>
                      <CButton size="sm" :color="u.estado === 'AI' ? 'warning' : 'success'" variant="outline"
                        :title="u.estado === 'AI' ? 'Desactivar' : 'Activar'"
                        @click="handleToggle(u)">
                        <PowerOff v-if="u.estado === 'AI'" :size="13" /><Power v-else :size="13" />
                      </CButton>
                      <!-- La contraseña de un usuario LDAP se resetea en el directorio -->
                      <CButton v-if="u.auth_source !== 'LDAP'" size="sm" color="info" variant="outline"
                        title="Resetear contraseña" @click="openModal('reset-pwd', u)">
                        <KeyRound :size="13" />
                      </CButton>
                      <CButton v-if="u.locked_until && new Date(u.locked_until) > new Date()"
                        size="sm" color="success" variant="outline" title="Desbloquear cuenta" @click="handleUnlock(u)">
                        <LockOpen :size="13" />
                      </CButton>
                      <CButton v-if="u.mfa_enabled" size="sm" color="warning" variant="outline"
                        title="Restablecer segundo factor" @click="openModal('reset-mfa', u)">
                        <ShieldOff :size="13" />
                      </CButton>
                      <CButton size="sm" color="danger" variant="outline" title="Eliminar" @click="openModal('delete', u)">
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

    <!-- Footer -->
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
        <span>{{ total === 0 ? 'Sin resultados' : `Mostrando ${(page-1)*limit+1}–${Math.min(page*limit,total)} de ${total}` }}</span>
      </div>
      <CPagination class="mb-0">
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

    <!-- Modal Crear -->
    <CModal :visible="modal === 'create'" @close="closeModal" size="lg">
      <CModalHeader><CModalTitle>Nuevo usuario</CModalTitle></CModalHeader>
      <CModalBody>
        <CAlert v-if="catalogsError" color="warning" class="py-2 small mb-3">
          {{ catalogsError }}
        </CAlert>
        <UserForm :roles="roles" :teams="teams" :ldap="ldap" :is-edit="false"
          :loading="modalLoading" :error="modalError"
          @save="handleCreate" @cancel="closeModal" />
      </CModalBody>
    </CModal>

    <!-- Modal Editar -->
    <CModal :visible="modal === 'edit'" @close="closeModal" size="lg">
      <CModalHeader><CModalTitle>Editar usuario — {{ selectedUser?.username }}</CModalTitle></CModalHeader>
      <CModalBody>
        <UserForm v-if="selectedUser" :key="selectedUser.id"
          :initial="selectedUser" :roles="roles" :teams="teams" :ldap="ldap" :is-edit="true"
          :loading="modalLoading" :error="modalError"
          @save="handleUpdate" @cancel="closeModal" />
      </CModalBody>
    </CModal>

    <!-- Modal Reset contraseña -->
    <CModal :visible="modal === 'reset-pwd'" @close="closeModal">
      <CModalHeader><CModalTitle>Resetear contraseña</CModalTitle></CModalHeader>
      <CModalBody>
        <ResetPwdForm v-if="selectedUser" :user="selectedUser"
          :loading="modalLoading" :error="modalError"
          @save="handleResetPwd" @cancel="closeModal" />
      </CModalBody>
    </CModal>

    <!-- Modal Eliminar -->
    <!-- Restablecer el segundo factor de otro usuario (perdió el móvil) -->
    <CModal :visible="modal === 'reset-mfa'" @close="closeModal">
      <CModalHeader><CModalTitle>Restablecer segundo factor</CModalTitle></CModalHeader>
      <CModalBody>
        <CAlert v-if="modalError" color="danger" class="py-2 small">{{ modalError }}</CAlert>
        <p class="mb-1">¿Quitar el segundo factor de <strong>{{ selectedUser?.username }}</strong>?</p>
        <p class="text-medium-emphasis small mb-0">
          Se borrarán su clave y sus códigos de recuperación, y se cerrarán sus sesiones. Si la
          política lo exige, tendrá que volver a activarlo en su siguiente acceso.
        </p>
      </CModalBody>
      <CModalFooter>
        <CButton color="secondary" variant="outline" @click="closeModal" :disabled="modalLoading">Cancelar</CButton>
        <CButton color="warning" @click="handleResetMfa" :disabled="modalLoading">
          <CSpinner v-if="modalLoading" size="sm" /><template v-else>Restablecer</template>
        </CButton>
      </CModalFooter>
    </CModal>

    <CModal :visible="modal === 'delete'" @close="closeModal">
      <CModalHeader><CModalTitle class="text-danger">Eliminar usuario</CModalTitle></CModalHeader>
      <CModalBody>
        <CAlert v-if="modalError" color="danger" class="py-2 small">{{ modalError }}</CAlert>
        <p>¿Estás seguro de que deseas eliminar al usuario <strong>{{ selectedUser?.username }}</strong>?</p>
        <p class="text-medium-emphasis small">
          Esta acción es lógica (soft delete). El usuario no podrá acceder al sistema
          y sus sesiones activas serán revocadas.
        </p>
      </CModalBody>
      <CModalFooter>
        <CButton color="secondary" variant="outline" @click="closeModal">Cancelar</CButton>
        <CButton color="danger" @click="handleDelete" :disabled="modalLoading">
          <CSpinner v-if="modalLoading" size="sm" class="me-2" />
          {{ modalLoading ? 'Eliminando...' : 'Confirmar eliminación' }}
        </CButton>
      </CModalFooter>
    </CModal>

  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { Lock, LockOpen, Pencil, Power, PowerOff, KeyRound, Trash2, ShieldCheck, ShieldOff } from 'lucide-vue-next'
import api from '../../api/index.js'
import UserForm from '../../components/users/UserForm.vue'
import ResetPwdForm from '../../components/users/ResetPwdForm.vue'

// ─── Sub-components ───────────────────────────────────────────────────────────

// ─── Page state ───────────────────────────────────────────────────────────────

const ROLE_COLORS  = { ADMIN: 'danger', OPERATOR: 'warning', VIEWER: 'info', VISITOR: 'secondary' }
const ESTADO_COLOR = { AI: 'success', IN: 'secondary' }
const ESTADO_LABEL = { AI: 'Activo', IN: 'Inactivo' }
const EMPTY_FILTERS = { search: '', role: '', team: '', estado: '' }

const users    = ref([])
const total    = ref(0)
const page     = ref(1)
const limit    = ref(25)
const filters  = reactive({ ...EMPTY_FILTERS })
const applied  = reactive({ ...EMPTY_FILTERS })
const roles    = ref([])
const teams    = ref([])
const ldap     = ref({ configured: false, enabled: false })
const loading  = ref(true)
const error    = ref(null)
const toast    = ref(null)

const modal          = ref(null)
const selectedUser   = ref(null)
const modalLoading   = ref(false)
const modalError     = ref(null)
const catalogsError  = ref(null)

const hasFilters = computed(() => Object.values(applied).some(Boolean))
const totalPages = computed(() => Math.ceil(total.value / limit.value) || 1)

function showToast(msg, color = 'success') {
  toast.value = { msg, color }
  setTimeout(() => { toast.value = null }, 3500)
}

async function loadUsers() {
  loading.value = true; error.value = null
  try {
    const params = new URLSearchParams({ page: page.value, limit: limit.value })
    if (applied.search)  params.set('search',   applied.search)
    if (applied.role)    params.set('roleCode', applied.role)
    if (applied.team)    params.set('teamCode', applied.team)
    if (applied.estado)  params.set('estado',   applied.estado)
    const data = await api.get(`/admin/users?${params.toString()}`)
    users.value = data.users
    total.value = data.total
  } catch (err) {
    error.value = err?.message || 'Error al cargar usuarios.'
  } finally {
    loading.value = false
  }
}

function applyFilters() { Object.assign(applied, { ...filters }); page.value = 1; loadUsers() }
function resetFilters() {
  Object.assign(filters, { ...EMPTY_FILTERS })
  Object.assign(applied, { ...EMPTY_FILTERS })
  page.value = 1; loadUsers()
}

function openModal(type, user = null) { selectedUser.value = user; modal.value = type; modalError.value = null }
function closeModal() { modal.value = null; selectedUser.value = null; modalError.value = null }
function changePage(p) { page.value = p; loadUsers() }

function paginationPages(current, tot) {
  if (tot <= 7) return Array.from({ length: tot }, (_, i) => i + 1)
  const pages = [1]
  if (current > 3) pages.push('...')
  for (let i = Math.max(2, current - 1); i <= Math.min(tot - 1, current + 1); i++) pages.push(i)
  if (current < tot - 2) pages.push('...')
  pages.push(tot)
  return pages
}

async function handleCreate(form) {
  modalLoading.value = true; modalError.value = null
  try {
    await api.post('/admin/users', form)
    closeModal(); loadUsers()
    showToast(`Usuario ${form.username} creado correctamente.`)
  } catch (err) {
    modalError.value = err?.message || err?.errors?.[0]?.msg || 'Error al crear usuario.'
  } finally { modalLoading.value = false }
}

async function handleUpdate(form) {
  modalLoading.value = true; modalError.value = null
  try {
    await api.put(`/admin/users/${selectedUser.value.id}`, form)
    closeModal(); loadUsers()
    showToast('Usuario actualizado correctamente.')
  } catch (err) {
    modalError.value = err?.message || 'Error al actualizar usuario.'
  } finally { modalLoading.value = false }
}

async function handleToggle(user) {
  try {
    await api.patch(`/admin/users/${user.id}/toggle-estado`)
    loadUsers()
    showToast(`Usuario ${user.username} ${user.estado === 'AI' ? 'desactivado' : 'activado'}.`)
  } catch (err) { showToast(err?.message || 'Error al cambiar estado.', 'danger') }
}

async function handleDelete() {
  modalLoading.value = true
  try {
    await api.delete(`/admin/users/${selectedUser.value.id}`)
    closeModal(); loadUsers()
    showToast(`Usuario ${selectedUser.value.username} eliminado.`)
  } catch (err) {
    modalError.value = err?.message || 'Error al eliminar usuario.'
  } finally { modalLoading.value = false }
}

async function handleResetPwd(newPassword) {
  modalLoading.value = true; modalError.value = null
  try {
    await api.post(`/admin/users/${selectedUser.value.id}/reset-password`, { newPassword })
    closeModal()
    showToast('Contraseña reseteada. El usuario deberá cambiarla al ingresar.')
  } catch (err) {
    modalError.value = err?.message || 'Error al resetear contraseña.'
  } finally { modalLoading.value = false }
}

async function handleResetMfa() {
  modalLoading.value = true; modalError.value = null
  try {
    await api.post(`/admin/users/${selectedUser.value.id}/mfa/reset`)
    closeModal(); loadUsers()
    showToast(`Segundo factor de ${selectedUser.value?.username || 'el usuario'} restablecido.`)
  } catch (err) {
    modalError.value = err?.message || 'Error al restablecer el segundo factor.'
  } finally { modalLoading.value = false }
}

async function handleUnlock(user) {
  try {
    await api.post(`/admin/users/${user.id}/unlock`)
    loadUsers()
    showToast(`Cuenta de ${user.username} desbloqueada.`)
  } catch (err) { showToast(err?.message || 'Error al desbloquear.', 'danger') }
}

watch(limit, () => { page.value = 1; loadUsers() })

onMounted(() => {
  loadUsers()
  api.get('/admin/users/catalogs')
    .then(data => {
      roles.value = data.roles; teams.value = data.teams
      if (data.ldap) ldap.value = data.ldap
    })
    .catch(err => { catalogsError.value = err?.message || 'Error al cargar roles y equipos.' })
})
</script>
