<template>
  <div class="bg-body-tertiary py-4" style="height: 100%; overflow-y: auto">
    <CContainer style="max-width: 900px">

      <div v-if="loading" style="display: flex; justify-content: center; align-items: center; padding-top: 4rem">
        <CSpinner color="primary" />
      </div>

      <template v-else>
        <CAlert color="info" class="mb-4 small">
          Los cambios se aplican de inmediato. Los parámetros marcados como
          <CBadge color="info" style="font-size: 10px">público</CBadge>
          son legibles sin autenticación (timezone, locale, nombre de la app).
        </CAlert>

        <CAlert v-if="error" color="danger">{{ error }}</CAlert>

        <template v-for="cat in categoryOrder" :key="cat">
          <CCard v-if="byCategory[cat] && byCategory[cat].length > 0" class="shadow-sm mb-4">
            <CCardHeader class="py-2">
              <span class="fw-semibold small">{{ CATEGORY_LABELS[cat] || cat }}</span>
            </CCardHeader>
            <CCardBody class="p-0 px-3">
              <div v-for="setting in byCategory[cat]" :key="setting.key"
                class="py-3" style="border-bottom: 1px solid var(--cui-border-color)">
                <CRow class="align-items-start g-2">
                  <CCol :md="5">
                    <div class="d-flex align-items-center gap-2 mb-1">
                      <CFormLabel class="mb-0 fw-semibold small">{{ setting.label }}</CFormLabel>
                      <CBadge v-if="setting.is_public" color="info" class="small" style="font-size: 10px">público</CBadge>
                    </div>
                    <p v-if="setting.description" class="text-medium-emphasis mb-0" style="font-size: 12px">
                      {{ setting.description }}
                    </p>
                    <p v-if="setting.updated_by_username" class="text-medium-emphasis mb-0" style="font-size: 11px">
                      Actualizado por <strong>{{ setting.updated_by_username }}</strong>
                      · {{ new Date(setting.updated_at).toLocaleString() }}
                    </p>
                  </CCol>
                  <CCol :md="5">
                    <!-- Timezone -->
                    <CFormSelect v-if="setting.key === 'timezone'" size="sm"
                      :model-value="editValues[setting.key]"
                      @change="editValues[setting.key] = $event.target.value"
                      style="font-family: monospace">
                      <option v-for="tz in TIMEZONES" :key="tz.value" :value="tz.value">{{ tz.label }}</option>
                    </CFormSelect>
                    <!-- Locale -->
                    <CFormSelect v-else-if="setting.key === 'locale'" size="sm"
                      :model-value="editValues[setting.key]"
                      @change="editValues[setting.key] = $event.target.value">
                      <option v-for="lc in LOCALES" :key="lc.value" :value="lc.value">{{ lc.label }}</option>
                    </CFormSelect>
                    <!-- Política del segundo factor: lista cerrada (el PUT la valida igual) -->
                    <CFormSelect v-else-if="setting.key === 'mfa_policy'" size="sm"
                      :model-value="editValues[setting.key]"
                      @change="editValues[setting.key] = $event.target.value">
                      <option v-for="p in MFA_POLICIES" :key="p.value" :value="p.value">{{ p.label }}</option>
                    </CFormSelect>
                    <!-- Boolean -->
                    <CFormSelect v-else-if="setting.type === 'boolean'" size="sm"
                      :model-value="editValues[setting.key]"
                      @change="editValues[setting.key] = $event.target.value">
                      <option value="true">Sí (activado)</option>
                      <option value="false">No (desactivado)</option>
                    </CFormSelect>
                    <!-- Integer -->
                    <CFormInput v-else-if="setting.type === 'integer'" type="number" size="sm" :min="0"
                      :model-value="editValues[setting.key]"
                      @input="editValues[setting.key] = $event.target.value"
                      style="font-family: monospace; max-width: 180px" />
                    <!-- Default text -->
                    <CFormInput v-else type="text" size="sm"
                      :model-value="editValues[setting.key]"
                      @input="editValues[setting.key] = $event.target.value"
                      style="font-family: monospace" />
                    <div v-if="saveErrors[setting.key]" class="text-danger mt-1" style="font-size: 12px">
                      {{ saveErrors[setting.key] }}
                    </div>
                  </CCol>
                  <CCol :md="2" class="d-flex gap-2 align-items-center">
                    <CButton
                      :color="savedKeys.has(setting.key) ? 'success' : 'primary'"
                      size="sm"
                      :disabled="editValues[setting.key] === setting.value || saving === setting.key"
                      @click="handleSave(setting)"
                    >
                      <CSpinner v-if="saving === setting.key" size="sm" />
                      <template v-else-if="savedKeys.has(setting.key)"><Check :size="14" class="me-1" /> Guardado</template>
                      <template v-else>Guardar</template>
                    </CButton>
                    <CButton
                      v-if="editValues[setting.key] !== setting.value && saving !== setting.key"
                      color="secondary" variant="ghost" size="sm"
                      @click="editValues[setting.key] = setting.value">
                      <X :size="14" />
                    </CButton>
                  </CCol>
                </CRow>
              </div>
            </CCardBody>
          </CCard>
        </template>

        <!-- Directorio LDAP. Guardar la conexión pide contraseña y segundo factor:
             quien controla la URL recibe las contraseñas de dominio. Se activa con
             el ajuste ldap_enabled de Seguridad. -->
        <CCard v-if="ldap" class="shadow-sm mb-4">
          <CCardHeader class="py-2 d-flex align-items-center gap-2">
            <span class="fw-semibold small">Directorio (Active Directory / LDAP)</span>
            <CBadge :color="ldap.enabled ? 'success' : 'secondary'" style="font-size: 10px">
              {{ ldap.enabled ? 'activo' : 'inactivo' }}
            </CBadge>
          </CCardHeader>
          <CCardBody class="px-3 py-3">
            <p class="text-medium-emphasis mb-3" style="font-size: 12px">
              Conexión con el directorio. Se activa con el ajuste «Autenticación con Active Directory / LDAP»
              de Seguridad, y solo entran por LDAP los usuarios dados de alta con ese origen en Usuarios.
            </p>
            <CAlert v-if="ldap.error" color="warning" class="py-2 small mb-3">{{ ldap.error }}</CAlert>

            <CRow class="g-3">
              <CCol :md="7">
                <CFormLabel class="small fw-semibold mb-1">Servidor</CFormLabel>
                <CFormInput size="sm" v-model.trim="ldapForm.url" placeholder="ldaps://ad.empresa.local:636"
                  style="font-family: monospace" />
              </CCol>
              <CCol :md="5">
                <CFormLabel class="small fw-semibold mb-1">Formato del usuario</CFormLabel>
                <CFormInput size="sm" v-model.trim="ldapForm.bindTemplate" placeholder="DOMINIO\{username}"
                  style="font-family: monospace" />
              </CCol>
              <CCol :md="4" class="d-flex flex-column gap-1">
                <CFormCheck v-model="ldapForm.startTls" label="Usar StartTLS" :disabled="isLdaps" />
                <CFormCheck v-model="ldapForm.tlsVerify" label="Validar el certificado" :disabled="formInsecure" />
              </CCol>
              <CCol :md="3">
                <CFormLabel class="small fw-semibold mb-1">Tiempo máximo (ms)</CFormLabel>
                <CFormInput size="sm" type="number" v-model.number="ldapForm.timeoutMs" min="1000" max="60000" />
              </CCol>
              <CCol :md="12">
                <CFormLabel class="small fw-semibold mb-1">
                  Certificado de la CA <span class="text-medium-emphasis fw-normal">(PEM, opcional)</span>
                </CFormLabel>
                <CFormTextarea size="sm" rows="3" v-model.trim="ldapForm.caCert" :disabled="formInsecure"
                  placeholder="-----BEGIN CERTIFICATE-----" style="font-family: monospace; font-size: 11px" />
              </CCol>
            </CRow>
            <CAlert v-if="ldapForm.url && formInsecure" color="warning" class="py-2 small mt-3 mb-0">
              Conexión sin cifrar: la contraseña de dominio de cada usuario viajará en claro por la red.
              Usa <code>ldaps://</code> o StartTLS si el servidor lo admite.
            </CAlert>

            <!-- Probar con los valores del formulario, aunque no estén guardados -->
            <div class="fw-semibold small mt-4 mb-1">Probar conexión</div>
            <p class="text-medium-emphasis mb-2" style="font-size: 12px">
              Bind real con un usuario del dominio (por ejemplo, el tuyo) y los valores de arriba, sin guardarlos.
              Queda en la auditoría. Funciona aunque LDAP esté desactivado.
            </p>
            <form class="row g-2 align-items-end" @submit.prevent="handleLdapTest">
              <CCol :md="4">
                <CFormLabel class="small mb-1">Usuario del dominio</CFormLabel>
                <CFormInput size="sm" v-model="ldapTest.username" autocomplete="off" />
              </CCol>
              <CCol :md="4">
                <CFormLabel class="small mb-1">Contraseña</CFormLabel>
                <CFormInput size="sm" type="password" v-model="ldapTest.password" autocomplete="off" />
              </CCol>
              <CCol :md="4">
                <CButton type="submit" color="secondary" variant="outline" size="sm"
                  :disabled="ldapTesting || !ldapTest.username || !ldapTest.password || !ldapForm.url">
                  <CSpinner v-if="ldapTesting" size="sm" /><template v-else>Probar</template>
                </CButton>
              </CCol>
            </form>
            <CAlert v-if="ldapTestResult" :color="ldapTestResult.success ? 'success' : 'danger'"
              class="py-2 small mt-2 mb-0">{{ ldapTestResult.message }}</CAlert>

            <!-- Guardar: reconfirmación con contraseña y segundo factor -->
            <div class="fw-semibold small mt-4 mb-1">Guardar cambios</div>
            <CAlert v-if="!ldap.canSave" color="info" class="py-2 small mb-0">
              Para cambiar la conexión LDAP necesitas tener activado el segundo factor (Mi Perfil).
            </CAlert>
            <template v-else>
              <p class="text-medium-emphasis mb-2" style="font-size: 12px">
                Confirma tu identidad para guardar. El cambio queda en la auditoría con el valor anterior y el nuevo.
              </p>
              <form class="row g-2 align-items-end" @submit.prevent="handleLdapSave">
                <CCol :md="4">
                  <CFormLabel class="small mb-1">Tu contraseña</CFormLabel>
                  <CFormInput size="sm" type="password" v-model="ldapReauth.password" autocomplete="current-password" />
                </CCol>
                <CCol :md="4">
                  <CFormLabel class="small mb-1">Código del segundo factor</CFormLabel>
                  <CFormInput size="sm" v-model="ldapReauth.code" placeholder="000000" autocomplete="one-time-code"
                    style="font-family: monospace" />
                </CCol>
                <CCol :md="4" class="d-flex gap-2">
                  <CButton type="submit" :color="ldapSaved ? 'success' : 'primary'" size="sm"
                    :disabled="ldapSaving || !ldapDirty || !ldapReauth.password || !ldapReauth.code">
                    <CSpinner v-if="ldapSaving" size="sm" />
                    <template v-else-if="ldapSaved"><Check :size="14" class="me-1" /> Guardado</template>
                    <template v-else>Guardar</template>
                  </CButton>
                  <CButton v-if="ldapDirty && !ldapSaving" color="secondary" variant="ghost" size="sm"
                    title="Descartar cambios" @click="resetLdapForm">
                    <X :size="14" />
                  </CButton>
                </CCol>
              </form>
              <CAlert v-if="ldapSaveError" color="danger" class="py-2 small mt-2 mb-0">{{ ldapSaveError }}</CAlert>
            </template>
          </CCardBody>
        </CCard>

        <!-- Límites de peticiones: solo lectura. Se fijan en backend/.env o en el
             código, no aquí (ver backend/src/config/rateLimits.js). -->
        <CCard v-if="limits.length" class="shadow-sm mb-4">
          <CCardHeader class="py-2 d-flex align-items-center gap-2">
            <span class="fw-semibold small">Límites de peticiones</span>
            <CBadge color="secondary" style="font-size: 10px">solo lectura</CBadge>
          </CCardHeader>
          <CCardBody class="px-3 py-2">
            <p class="text-medium-emphasis mb-2" style="font-size: 12px">
              Protecciones contra abuso que dependen del despliegue. Las que indican una variable se
              cambian en <code>backend/.env</code> y requieren reiniciar el backend; su ventana la fija
              <code>{{ windowSource }}</code>. Las marcadas como <em>fijo</em> están en el código.
            </p>
            <div style="overflow-x: auto">
              <table class="table table-sm small mb-0 align-middle">
                <thead>
                  <tr class="text-medium-emphasis">
                    <th class="fw-semibold">Límite</th>
                    <th class="fw-semibold text-end">Máximo</th>
                    <th class="fw-semibold">Por</th>
                    <th class="fw-semibold">Origen</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="l in limits" :key="l.label">
                    <td>{{ l.label }}</td>
                    <td class="text-end text-nowrap font-monospace">{{ l.max }} / {{ formatWindow(l.windowMinutes) }}</td>
                    <td class="text-nowrap">{{ l.scope }}</td>
                    <td>
                      <code v-if="l.source">{{ l.source }}</code>
                      <span v-else class="text-medium-emphasis fst-italic">fijo</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CCardBody>
        </CCard>
      </template>

    </CContainer>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { Check, X } from 'lucide-vue-next'
import api from '../../api/index.js'
import { useSettingsStore } from '../../store/settingsStore.js'

const settingsStore = useSettingsStore()

const CATEGORY_LABELS = { general: 'General', security: 'Seguridad', notifications: 'Notificaciones' }
const categoryOrder   = ['general', 'security', 'notifications']

const TIMEZONES = [
  { value: 'America/Lima',           label: 'America/Lima — Perú (UTC−5)' },
  { value: 'America/Bogota',         label: 'America/Bogota — Colombia (UTC−5)' },
  { value: 'America/Guayaquil',      label: 'America/Guayaquil — Ecuador (UTC−5)' },
  { value: 'America/Panama',         label: 'America/Panama — Panamá (UTC−5)' },
  { value: 'America/Caracas',        label: 'America/Caracas — Venezuela (UTC−4)' },
  { value: 'America/La_Paz',         label: 'America/La_Paz — Bolivia (UTC−4)' },
  { value: 'America/Santiago',       label: 'America/Santiago — Chile (UTC−4/−3)' },
  { value: 'America/Argentina/Buenos_Aires', label: 'America/Buenos_Aires — Argentina (UTC−3)' },
  { value: 'America/Sao_Paulo',      label: 'America/Sao_Paulo — Brasil (UTC−3)' },
  { value: 'America/Montevideo',     label: 'America/Montevideo — Uruguay (UTC−3)' },
  { value: 'America/Asuncion',       label: 'America/Asuncion — Paraguay (UTC−4/−3)' },
  { value: 'America/Mexico_City',    label: 'America/Mexico_City — México (UTC−6/−5)' },
  { value: 'America/New_York',       label: 'America/New_York — EE. UU. Este (UTC−5/−4)' },
  { value: 'America/Chicago',        label: 'America/Chicago — EE. UU. Centro (UTC−6/−5)' },
  { value: 'America/Los_Angeles',    label: 'America/Los_Angeles — EE. UU. Pacífico (UTC−8/−7)' },
  { value: 'UTC',                    label: 'UTC — Tiempo Universal (UTC+0)' },
  { value: 'Europe/Madrid',          label: 'Europe/Madrid — España (UTC+1/+2)' },
  { value: 'Europe/London',          label: 'Europe/London — Reino Unido (UTC+0/+1)' },
]

const MFA_POLICIES = [
  { value: 'all',    label: 'Obligatorio para todos' },
  { value: 'admins', label: 'Obligatorio solo para administradores' },
  { value: 'none',   label: 'Opcional: cada usuario decide' },
]

const LOCALES = [
  { value: 'es-PE', label: 'es-PE — Español (Perú)' },
  { value: 'es-CO', label: 'es-CO — Español (Colombia)' },
  { value: 'es-CL', label: 'es-CL — Español (Chile)' },
  { value: 'es-AR', label: 'es-AR — Español (Argentina)' },
  { value: 'es-MX', label: 'es-MX — Español (México)' },
  { value: 'es-ES', label: 'es-ES — Español (España)' },
  { value: 'en-US', label: 'en-US — English (United States)' },
  { value: 'pt-BR', label: 'pt-BR — Português (Brasil)' },
]

const settings    = ref([])
const loading     = ref(true)
const error       = ref(null)
const editValues  = reactive({})
const saveErrors  = reactive({})
const savedKeys   = ref(new Set())
const saving      = ref(null)
const limits       = ref([])
const windowSource = ref('RATE_LIMIT_WINDOW_MS')
// ─── Directorio LDAP ─────────────────────────────────────────────────────────
const LDAP_FIELDS = ['url', 'bindTemplate', 'startTls', 'tlsVerify', 'caCert', 'timeoutMs']
const ldap           = ref(null)
const ldapForm       = reactive({ url: '', bindTemplate: '', startTls: false, tlsVerify: true, caCert: '', timeoutMs: 5000 })
const ldapTest       = reactive({ username: '', password: '' })
const ldapReauth     = reactive({ password: '', code: '' })
const ldapTesting    = ref(false)
const ldapTestResult = ref(null)
const ldapSaving     = ref(false)
const ldapSaveError  = ref(null)
const ldapSaved      = ref(false)

const isLdaps      = computed(() => ldapForm.url.toLowerCase().startsWith('ldaps://'))
const formInsecure = computed(() => !isLdaps.value && !ldapForm.startTls)
const ldapDirty    = computed(() => ldap.value && LDAP_FIELDS.some((f) => ldapForm[f] !== ldap.value[f]))

function ldapConfigPayload() {
  return {
    url: ldapForm.url, bindTemplate: ldapForm.bindTemplate,
    // StartTLS no aplica a ldaps://: se envía coherente con lo que se muestra.
    startTls: isLdaps.value ? false : ldapForm.startTls,
    tlsVerify: ldapForm.tlsVerify, caCert: ldapForm.caCert, timeoutMs: Number(ldapForm.timeoutMs),
  }
}

function resetLdapForm() {
  if (ldap.value) for (const f of LDAP_FIELDS) ldapForm[f] = ldap.value[f]
  ldapSaveError.value = null
}

// Si falla, la tarjeta no se muestra: el resto de la página sigue funcionando.
async function loadLdap() {
  try { ldap.value = (await api.get('/system/ldap')).ldap; resetLdapForm() } catch { ldap.value = null }
}

async function handleLdapTest() {
  ldapTesting.value = true; ldapTestResult.value = null
  try {
    // Un fallo de credenciales llega como 200 con success: false.
    const r = await api.post('/system/ldap/test', { ...ldapTest, config: ldapConfigPayload() })
    ldapTestResult.value = { success: r.success === true, message: r.message }
  } catch (err) {
    ldapTestResult.value = { success: false, message: err?.message || 'Error al probar la conexión.' }
  } finally {
    ldapTest.password = ''
    ldapTesting.value = false
  }
}

async function handleLdapSave() {
  ldapSaving.value = true; ldapSaveError.value = null
  try {
    await api.put('/system/ldap', { config: ldapConfigPayload(), ...ldapReauth })
    await loadLdap()
    ldapSaved.value = true
    setTimeout(() => { ldapSaved.value = false }, 2500)
  } catch (err) {
    ldapSaveError.value = err?.message || 'Error al guardar la conexión LDAP.'
  } finally {
    ldapReauth.password = ''; ldapReauth.code = ''
    ldapSaving.value = false
  }
}

function formatWindow(min) {
  return min % 60 === 0 ? `${min / 60} h` : `${min} min`
}

// Solo informativo: si falla, la página de ajustes sigue funcionando sin la tarjeta.
async function loadLimits() {
  try {
    const data = await api.get('/system/rate-limits')
    limits.value = data.limits || []
    windowSource.value = data.windowSource || windowSource.value
  } catch { limits.value = [] }
}

const byCategory = computed(() =>
  settings.value.reduce((acc, s) => {
    if (!acc[s.category]) acc[s.category] = []
    acc[s.category].push(s)
    return acc
  }, {})
)

async function loadSettings() {
  loading.value = true; error.value = null
  try {
    const data = await api.get('/system/settings')
    settings.value = data.settings || []
    // Inicializar editValues
    for (const s of settings.value) {
      editValues[s.key] = s.value
    }
  } catch (err) {
    error.value = err?.message || 'Error al cargar la configuración.'
  } finally {
    loading.value = false
  }
}

async function handleSave(setting) {
  saving.value = setting.key
  saveErrors[setting.key] = null
  try {
    await api.put(`/system/settings/${setting.key}`, { value: editValues[setting.key] })
    // Actualizar el valor en la lista
    const idx = settings.value.findIndex((s) => s.key === setting.key)
    if (idx !== -1) settings.value[idx] = { ...settings.value[idx], value: editValues[setting.key] }
    savedKeys.value = new Set([...savedKeys.value, setting.key])
    setTimeout(() => {
      savedKeys.value = new Set([...savedKeys.value].filter((k) => k !== setting.key))
    }, 2500)
    // Refrescar el store si fue un parámetro público
    if (['timezone', 'locale', 'app_name'].includes(setting.key)) {
      settingsStore.refresh()
    }
    if (setting.key === 'ldap_enabled') loadLdap()
  } catch (err) {
    saveErrors[setting.key] = err?.message || 'Error al guardar.'
  } finally {
    saving.value = null
  }
}

onMounted(() => { loadSettings(); loadLimits(); loadLdap() })
</script>
