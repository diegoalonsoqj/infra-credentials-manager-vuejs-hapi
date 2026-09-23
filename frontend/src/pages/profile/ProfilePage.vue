<template>
  <div class="bg-body-tertiary py-4" style="height: 100%; overflow-y: auto">
    <CContainer style="max-width: 800px">

      <div v-if="loading" style="height: 100%; display: flex; justify-content: center; align-items: center; padding-top: 4rem">
        <CSpinner color="primary" />
      </div>

      <template v-else>
        <CAlert v-if="error" color="danger">{{ error }}</CAlert>

        <template v-if="profile">

          <CAlert v-if="profile.force_pwd_change" color="warning" class="mb-4">
            <strong>Acción requerida:</strong> Debes cambiar tu contraseña antes de continuar.
          </CAlert>

          <!-- Sección 1: Datos del perfil -->
          <CCard class="shadow-sm mb-4">
            <CCardHeader class="py-2">
              <span class="fw-semibold small">Información de la cuenta</span>
            </CCardHeader>
            <CCardBody>
              <CRow class="g-3">
                <CCol :md="6">
                  <div class="small text-medium-emphasis mb-1">Usuario</div>
                  <div class="fw-semibold">{{ profile.username }}</div>
                </CCol>
                <CCol :md="6">
                  <div class="small text-medium-emphasis mb-1">Nombre</div>
                  <div class="fw-semibold">
                    {{ (profile.first_name || profile.last_name) ? `${profile.first_name} ${profile.last_name}` : profile.full_name }}
                  </div>
                </CCol>
                <CCol :md="6">
                  <div class="small text-medium-emphasis mb-1">Correo electrónico</div>
                  <div>{{ profile.email }}</div>
                </CCol>
                <CCol :md="6">
                  <div class="small text-medium-emphasis mb-1">Rol</div>
                  <div class="d-flex align-items-center gap-2">
                    <CBadge :color="roleInfo.color">{{ roleInfo.label }}</CBadge>
                    <CBadge v-if="profile.team" color="secondary">{{ profile.team_name || profile.team }}</CBadge>
                  </div>
                </CCol>
                <CCol :md="6">
                  <div class="small text-medium-emphasis mb-1">Último acceso</div>
                  <div class="text-medium-emphasis" style="font-size: 13px">{{ formatDate(profile.last_login_at) }}</div>
                </CCol>
                <CCol :md="6">
                  <div class="small text-medium-emphasis mb-1">Cuenta creada</div>
                  <div class="text-medium-emphasis" style="font-size: 13px">{{ formatDate(profile.created_at) }}</div>
                </CCol>
              </CRow>
            </CCardBody>
          </CCard>

          <!-- Sección 2: Cambio de contraseña. Un usuario LDAP usa la del dominio. -->
          <CCard v-if="profile.auth_source === 'LDAP'" class="shadow-sm mb-4">
            <CCardHeader class="py-2">
              <span class="fw-semibold small">Contraseña</span>
            </CCardHeader>
            <CCardBody class="small text-medium-emphasis">
              Entras con tu <strong>contraseña de dominio</strong> (Active Directory). Para cambiarla,
              hazlo en el directorio, como en el resto de sistemas de la empresa: ICM no la guarda.
            </CCardBody>
          </CCard>
          <CCard v-else class="shadow-sm mb-4">
            <CCardHeader class="py-2">
              <span class="fw-semibold small">Cambiar contraseña</span>
            </CCardHeader>
            <CCardBody>
              <CAlert v-if="pwdError"   color="danger"  class="py-2 small">{{ pwdError }}</CAlert>
              <CAlert v-if="pwdSuccess" color="success" class="py-2 small">{{ pwdSuccess }}</CAlert>
              <form @submit.prevent="handleChangePwd">
                <CRow class="g-3">
                  <CCol :md="12">
                    <CFormLabel class="small fw-semibold">Contraseña actual</CFormLabel>
                    <CInputGroup size="sm">
                      <CFormInput :type="showPwd.current ? 'text' : 'password'" v-model="pwdForm.currentPassword" required />
                      <CButton color="secondary" variant="outline" type="button"
                        @click="showPwd.current = !showPwd.current">
                        <EyeOff v-if="showPwd.current" :size="16" /><Eye v-else :size="16" />
                      </CButton>
                    </CInputGroup>
                  </CCol>
                  <CCol :md="6">
                    <CFormLabel class="small fw-semibold">Nueva contraseña</CFormLabel>
                    <CInputGroup size="sm">
                      <CFormInput :type="showPwd.newPwd ? 'text' : 'password'" placeholder="Mínimo 12 caracteres" v-model="pwdForm.newPassword" required />
                      <CButton color="secondary" variant="outline" type="button"
                        @click="showPwd.newPwd = !showPwd.newPwd">
                        <EyeOff v-if="showPwd.newPwd" :size="16" /><Eye v-else :size="16" />
                      </CButton>
                    </CInputGroup>
                  </CCol>
                  <CCol :md="6">
                    <CFormLabel class="small fw-semibold">Confirmar nueva contraseña</CFormLabel>
                    <CInputGroup size="sm">
                      <CFormInput :type="showPwd.confirm ? 'text' : 'password'" placeholder="Repetir contraseña" v-model="pwdForm.confirm" required />
                      <CButton color="secondary" variant="outline" type="button"
                        @click="showPwd.confirm = !showPwd.confirm">
                        <EyeOff v-if="showPwd.confirm" :size="16" /><Eye v-else :size="16" />
                      </CButton>
                    </CInputGroup>
                  </CCol>
                  <CCol :md="12">
                    <CButton color="primary" size="sm" type="submit" :disabled="pwdSaving">
                      <CSpinner v-if="pwdSaving" size="sm" />
                      <template v-else>Actualizar contraseña</template>
                    </CButton>
                  </CCol>
                </CRow>
              </form>
            </CCardBody>
          </CCard>

          <!-- Sección 3: Segundo factor -->
          <MfaCard />

          <!-- Sección 4: Sesiones activas -->
          <CCard class="shadow-sm">
            <CCardHeader class="py-2 d-flex align-items-center justify-content-between">
              <span class="fw-semibold small">Sesiones activas ({{ sessions.length }})</span>
              <CButton v-if="otherSessions.length > 0" color="danger" variant="outline" size="sm"
                @click="showRevokeAll = true">
                Cerrar todas las demás
              </CButton>
            </CCardHeader>
            <CCardBody class="p-0">
              <CAlert v-if="sessionError" color="danger" class="m-3 py-2 small">{{ sessionError }}</CAlert>
              <p v-if="sessions.length === 0" class="text-center text-medium-emphasis small py-4 mb-0">Sin sesiones activas.</p>
              <CTable v-else small hover responsive class="mb-0" style="font-size: 13px">
                <CTableHead>
                  <CTableRow>
                    <CTableHeaderCell>Navegador</CTableHeaderCell>
                    <CTableHeaderCell>IP</CTableHeaderCell>
                    <CTableHeaderCell>Inicio</CTableHeaderCell>
                    <CTableHeaderCell>Expira</CTableHeaderCell>
                    <CTableHeaderCell></CTableHeaderCell>
                  </CTableRow>
                </CTableHead>
                <CTableBody>
                  <CTableRow v-for="s in sessions" :key="s.id">
                    <CTableDataCell>
                      {{ parseUA(s.user_agent) }}
                      <CBadge v-if="s.is_current" color="success" class="ms-2" style="font-size: 10px">Sesión actual</CBadge>
                    </CTableDataCell>
                    <CTableDataCell class="text-medium-emphasis">{{ s.ip_address || '—' }}</CTableDataCell>
                    <CTableDataCell class="text-medium-emphasis">{{ formatDate(s.created_at) }}</CTableDataCell>
                    <CTableDataCell class="text-medium-emphasis">{{ formatDate(s.expires_at) }}</CTableDataCell>
                    <CTableDataCell>
                      <CButton v-if="!s.is_current" color="danger" size="sm" variant="outline"
                        style="font-size: 11px" :disabled="revoking === s.id"
                        @click="handleRevokeOne(s.id)">
                        <CSpinner v-if="revoking === s.id" size="sm" /><template v-else>Revocar</template>
                      </CButton>
                    </CTableDataCell>
                  </CTableRow>
                </CTableBody>
              </CTable>
            </CCardBody>
          </CCard>

        </template>
      </template>

    </CContainer>

    <!-- Modal: confirmar revocar todas -->
    <CModal :visible="showRevokeAll" @close="showRevokeAll = false">
      <CModalHeader><CModalTitle>Cerrar otras sesiones</CModalTitle></CModalHeader>
      <CModalBody>
        <p class="mb-1">Se cerrarán <strong>{{ otherSessions.length }}</strong> sesión(es) activa(s) en otros dispositivos.</p>
        <p class="text-medium-emphasis small mb-0">Tu sesión actual no se verá afectada.</p>
      </CModalBody>
      <CModalFooter>
        <CButton color="secondary" variant="outline" @click="showRevokeAll = false" :disabled="revokingAll">Cancelar</CButton>
        <CButton color="danger" @click="handleRevokeAll" :disabled="revokingAll">
          <CSpinner v-if="revokingAll" size="sm" /><template v-else>Cerrar sesiones</template>
        </CButton>
      </CModalFooter>
    </CModal>

  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { Eye, EyeOff } from 'lucide-vue-next'
import { useAuthStore } from '../../store/authStore.js'
import api from '../../api/index.js'
import MfaCard from '../../components/profile/MfaCard.vue'

const authStore = useAuthStore()

const ROLE_LABELS = {
  ADMIN:    { label: 'Administrador', color: 'danger' },
  OPERATOR: { label: 'Operador',      color: 'warning' },
  VIEWER:   { label: 'Visor',         color: 'info' },
  VISITOR:  { label: 'Visitante',     color: 'secondary' },
}

const profile  = ref(null)
const sessions = ref([])
const loading  = ref(true)
const error    = ref(null)

const pwdForm    = reactive({ currentPassword: '', newPassword: '', confirm: '' })
const showPwd    = reactive({ current: false, newPwd: false, confirm: false })
const pwdError   = ref(null)
const pwdSuccess = ref(null)
const pwdSaving  = ref(false)

const revoking      = ref(null)
const revokingAll   = ref(false)
const sessionError  = ref(null)
const showRevokeAll = ref(false)

const roleInfo      = computed(() => ROLE_LABELS[profile.value?.role] || { label: profile.value?.role, color: 'secondary' })
const otherSessions = computed(() => sessions.value.filter((s) => !s.is_current))

function formatDate(d) { return d ? new Date(d).toLocaleString('es-PE') : '—' }
function parseUA(ua) {
  if (!ua) return '—'
  if (ua.includes('Firefox')) return 'Firefox'
  if (ua.includes('Chrome'))  return 'Chrome'
  if (ua.includes('Safari'))  return 'Safari'
  if (ua.includes('Edge'))    return 'Edge'
  return ua.slice(0, 40)
}

async function loadData() {
  loading.value = true; error.value = null
  try {
    const [profData, sessData] = await Promise.all([
      api.get('/profile'),
      api.get('/profile/sessions'),
    ])
    profile.value  = profData.profile
    sessions.value = sessData.sessions || []
  } catch (err) {
    error.value = err?.message || 'Error al cargar el perfil.'
  } finally {
    loading.value = false
  }
}

async function handleChangePwd() {
  pwdError.value = null; pwdSuccess.value = null
  if (pwdForm.newPassword !== pwdForm.confirm) {
    pwdError.value = 'Las contraseñas nuevas no coinciden.'; return
  }
  if (pwdForm.newPassword.length < 12) {
    pwdError.value = 'La nueva contraseña debe tener al menos 12 caracteres.'; return
  }
  pwdSaving.value = true
  try {
    await api.post('/profile/change-password', {
      currentPassword: pwdForm.currentPassword,
      newPassword: pwdForm.newPassword,
    })
    pwdSuccess.value = 'Contraseña actualizada correctamente.'
    pwdForm.currentPassword = ''; pwdForm.newPassword = ''; pwdForm.confirm = ''
    authStore.updateUser({ forcePwdChange: false })
    // El backend revoca las demás sesiones al cambiar la contraseña: sin
    // recargar, la lista las seguía mostrando y "Revocar" respondía 404.
    const data = await api.get('/profile/sessions')
    sessions.value = data.sessions || []
  } catch (err) {
    pwdError.value = err?.message || 'Error al cambiar la contraseña.'
  } finally {
    pwdSaving.value = false
  }
}

async function handleRevokeOne(sessionId) {
  revoking.value = sessionId; sessionError.value = null
  try {
    await api.delete(`/profile/sessions/${sessionId}`)
    sessions.value = sessions.value.filter((s) => s.id !== sessionId)
  } catch (err) {
    sessionError.value = err?.message || 'Error al revocar la sesión.'
  } finally {
    revoking.value = null
  }
}

async function handleRevokeAll() {
  revokingAll.value = true; sessionError.value = null
  try {
    await api.delete('/profile/sessions')
    const data = await api.get('/profile/sessions')
    sessions.value = data.sessions || []
    showRevokeAll.value = false
  } catch (err) {
    sessionError.value = err?.message || 'Error al revocar sesiones.'
  } finally {
    revokingAll.value = false
  }
}

onMounted(loadData)
</script>
