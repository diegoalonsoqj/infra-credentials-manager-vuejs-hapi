<!--
  UserForm.vue — Formulario de alta y edición de usuario.

  Extraído de UsersPage.vue, donde vivía como plantilla en
  string. Eso exigía el compilador de Vue en el navegador (new Function()), que
  la CSP del backend bloquea (script-src 'self', sin unsafe-eval) y dejaba la
  página en blanco en producción. Como SFC, Vite lo compila en el build.
-->
<template>
  <div>
    <CAlert v-if="error" color="danger" class="py-2 small mb-3">{{ error }}</CAlert>
    <CRow class="g-3">
      <CCol v-if="showAuthSource" :md="12">
        <CFormLabel class="fw-medium small">Origen de la contraseña</CFormLabel>
        <CFormSelect v-model="form.authSource">
          <option value="LOCAL">Local — contraseña propia de ICM</option>
          <option value="LDAP" :disabled="!ldap.configured">Directorio (Active Directory / LDAP)</option>
        </CFormSelect>
        <div v-if="form.authSource === 'LDAP'" class="text-medium-emphasis small mt-1">
          Entrará con su contraseña de dominio. El username debe ser su usuario del dominio.
          <span v-if="!ldap.enabled" class="text-warning">
            LDAP está desactivado en Configuración: no podrá entrar hasta que se active.
          </span>
        </div>
      </CCol>
      <CCol v-if="!isEdit" :md="6">
        <CFormLabel class="fw-medium small">Username</CFormLabel>
        <CFormInput v-model="form.username" :placeholder="form.authSource === 'LDAP' ? 'usuario del dominio' : 'usuario_01'" />
      </CCol>
      <CCol :md="6"><CFormLabel class="fw-medium small">Nombre *</CFormLabel>
        <CFormInput size="sm" v-model="form.firstName" placeholder="Nombre(s)" />
      </CCol>
      <CCol :md="6"><CFormLabel class="fw-medium small">Apellido *</CFormLabel>
        <CFormInput size="sm" v-model="form.lastName" placeholder="Apellido(s)" />
      </CCol>
      <CCol :md="12"><CFormLabel class="fw-medium small">Email</CFormLabel>
        <CFormInput type="email" v-model="form.email" placeholder="usuario@empresa.com" />
      </CCol>
      <CCol :md="6"><CFormLabel class="fw-medium small">Rol</CFormLabel>
        <CFormSelect v-model="form.roleCode">
          <option value="">— Seleccionar rol —</option>
          <option v-for="r in roles" :key="r.code" :value="r.code">{{ r.name }} ({{ r.code }})</option>
        </CFormSelect>
      </CCol>
      <CCol :md="6">
        <CFormLabel class="fw-medium small">Equipo <span v-if="needsTeam" class="text-danger">*</span></CFormLabel>
        <CFormSelect v-model="form.teamCode" :disabled="!needsTeam && form.roleCode !== ''">
          <option value="">— Sin equipo —</option>
          <option v-for="t in teams" :key="t.code" :value="t.code">{{ t.name }} ({{ (t.resource_types||[]).join(', ') }})</option>
        </CFormSelect>
        <div v-if="needsTeam && !form.teamCode" class="text-danger small mt-1">Requerido para este rol.</div>
      </CCol>
      <CCol v-if="!isEdit && form.authSource === 'LOCAL'" :md="12">
        <CFormLabel class="fw-medium small">Contraseña <span class="text-medium-emphasis">(mínimo 15 chars)</span></CFormLabel>
        <CFormInput type="password" v-model="form.password" placeholder="••••••••••••••••" autocomplete="new-password" />
        <PasswordGenerator :on-use="(pwd) => form.password = pwd" />
      </CCol>
      <!-- De LDAP a local: necesita una contraseña temporal, que cambiará al entrar -->
      <CCol v-if="switchingToLocal" :md="12">
        <CFormLabel class="fw-medium small">Contraseña temporal <span class="text-medium-emphasis">(mínimo 15 chars)</span></CFormLabel>
        <CFormInput type="password" v-model="form.newPassword" placeholder="••••••••••••••••" autocomplete="new-password" />
        <PasswordGenerator :on-use="(pwd) => form.newPassword = pwd" />
        <div class="text-medium-emphasis small mt-1">Deberá cambiarla en su próximo inicio de sesión.</div>
      </CCol>
    </CRow>
    <div class="d-flex gap-2 mt-4">
      <CButton color="secondary" variant="outline" @click="$emit('cancel')" :disabled="loading">Cancelar</CButton>
      <CButton color="primary" class="ms-auto" @click="$emit('save', { ...form })" :disabled="loading || !isValid">
        <CSpinner v-if="loading" size="sm" class="me-2" />
        <template v-if="isEdit">{{ loading ? 'Guardando...' : 'Guardar cambios' }}</template>
        <template v-else>{{ loading ? 'Creando...' : 'Crear usuario' }}</template>
      </CButton>
    </div>
  </div>
</template>

<script>
import { reactive, computed, defineComponent } from 'vue'
import PasswordGenerator from '../PasswordGenerator.vue'

export default defineComponent({
  name: 'UserForm',
  components: { PasswordGenerator },
  props: {
    initial:  { type: Object,  default: () => ({}) },
    roles:    { type: Array,   default: () => [] },
    teams:    { type: Array,   default: () => [] },
    // { configured, enabled } de GET /admin/users/catalogs
    ldap:     { type: Object,  default: () => ({ configured: false, enabled: false }) },
    isEdit:   { type: Boolean, default: false },
    loading:  { type: Boolean, default: false },
    error:    { type: String,  default: null },
  },
  emits: ['save', 'cancel'],
  setup(props) {
    const initialSource = props.initial.auth_source || 'LOCAL'
    const form = reactive({
      username:    props.initial.username   || '',
      email:       props.initial.email      || '',
      firstName:   props.initial.first_name || '',
      lastName:    props.initial.last_name  || '',
      password:    '',
      newPassword: '',
      roleCode:    props.initial.role       || '',
      teamCode:    props.initial.team       || '',
      authSource:  initialSource,
    })
    const selectedRole = computed(() => props.roles.find(r => r.code === form.roleCode))
    const needsTeam    = computed(() => selectedRole.value && selectedRole.value.level > 0 && selectedRole.value.level < 100)
    // Sin LDAP configurado el selector no aporta nada, salvo para un usuario que ya es LDAP.
    const showAuthSource   = computed(() => props.ldap.configured || initialSource === 'LDAP')
    const switchingToLocal = computed(() => props.isEdit && initialSource === 'LDAP' && form.authSource === 'LOCAL')
    const isValid      = computed(() =>
      form.email && form.firstName && form.lastName && form.roleCode &&
      (!needsTeam.value || form.teamCode) &&
      (props.isEdit || (form.username && (form.authSource === 'LDAP' || form.password.length >= 15))) &&
      (!switchingToLocal.value || form.newPassword.length >= 15)
    )
    return { form, needsTeam, isValid, showAuthSource, switchingToLocal }
  },
})
</script>
