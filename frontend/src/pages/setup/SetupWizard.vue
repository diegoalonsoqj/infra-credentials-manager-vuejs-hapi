<template>
  <!-- Token gate -->
  <div v-if="!tokenVerified"
    class="bg-body-tertiary min-vh-100 d-flex flex-column align-items-center justify-content-center py-4">
    <div style="width: 100%; max-width: 480px">
      <div class="text-center mb-4">
        <div style="width:52px;height:52px;border-radius:12px;background:var(--cui-primary);display:inline-flex;align-items:center;justify-content:center;margin-bottom:10px">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="white">
            <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 4l5 2.18V11c0 3.5-2.33 6.79-5 7.93C9.33 17.79 7 14.5 7 11V7.18L12 5z"/>
          </svg>
        </div>
        <h4 class="mb-1 fw-semibold">infra-credentials-manager</h4>
        <p class="text-medium-emphasis small">Configuración inicial del sistema</p>
      </div>
      <CCard class="shadow-sm">
        <CCardBody class="p-4">
          <h5 class="fw-semibold mb-1">Token de instalación</h5>
          <p class="text-medium-emphasis small mb-3">
            El sistema genera un token único al arrancar. Revisa los logs del servidor y pégalo aquí para continuar.
          </p>
          <CAlert v-if="tokenError" color="danger" class="py-2 small mb-3">{{ tokenError }}</CAlert>
          <form @submit.prevent="handleTokenSubmit">
            <div class="mb-3">
              <CFormLabel class="fw-medium small">Setup Token</CFormLabel>
              <CFormInput v-model="setupToken" type="text"
                placeholder="Pega aquí el token de los logs del servidor..." autofocus />
            </div>
            <CButton type="submit" color="primary" class="w-100" :disabled="!setupToken.trim()">
              Continuar con la instalación
            </CButton>
          </form>
        </CCardBody>
      </CCard>
    </div>
  </div>

  <!-- Wizard principal -->
  <div v-else
    class="bg-body-tertiary min-vh-100 d-flex flex-column align-items-center justify-content-center py-4"
    style="padding: 1rem">
    <div style="width: 100%; max-width: 620px">

      <!-- Header -->
      <div class="text-center mb-4">
        <div style="width:52px;height:52px;border-radius:12px;background:var(--cui-primary);display:inline-flex;align-items:center;justify-content:center;margin-bottom:10px">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="white">
            <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 4l5 2.18V11c0 3.5-2.33 6.79-5 7.93C9.33 17.79 7 14.5 7 11V7.18L12 5z"/>
          </svg>
        </div>
        <h4 class="mb-1 fw-semibold">infra-credentials-manager</h4>
        <p class="text-medium-emphasis small">Configuración inicial del sistema</p>
      </div>

      <!-- Barra de progreso -->
      <CProgress :value="progressValue" style="height:6px;border-radius:3px;margin-bottom:20px" color="primary" />

      <!-- Indicadores de paso -->
      <div class="d-flex align-items-start mb-4 px-2">
        <template v-for="(label, idx) in STEP_LABELS" :key="idx">
          <div class="d-flex flex-column align-items-center" style="flex: 1">
            <div :style="{
              width:'36px', height:'36px', borderRadius:'50%',
              display:'flex', alignItems:'center', justifyContent:'center',
              fontWeight:600, fontSize:'14px', transition:'all 0.3s ease',
              backgroundColor: idx < currentStep ? 'var(--cui-success)' : idx === currentStep ? 'var(--cui-primary)' : 'transparent',
              border: (idx < currentStep || idx === currentStep) ? 'none' : '2px solid var(--cui-secondary)',
              color: (idx < currentStep || idx === currentStep) ? '#fff' : 'var(--cui-secondary)',
            }">
              <Check v-if="idx < currentStep" :size="14" />
              <template v-else>{{ idx + 1 }}</template>
            </div>
            <span class="mt-1" :style="{
              fontSize:'11px', textAlign:'center', lineHeight:1.2,
              fontWeight: idx === currentStep ? 600 : 400,
              color: idx === currentStep ? 'var(--cui-primary)' : idx < currentStep ? 'var(--cui-success)' : 'var(--cui-secondary)',
              transition:'all 0.3s ease',
            }">{{ label }}</span>
          </div>
          <div v-if="idx < STEP_LABELS.length - 1" :style="{
            flex:1, height:'2px',
            backgroundColor: idx < currentStep ? 'var(--cui-success)' : 'var(--cui-border-color)',
            marginTop:'17px', transition:'background-color 0.3s ease',
          }" />
        </template>
      </div>

      <!-- Tarjeta principal -->
      <CCard class="shadow-sm">
        <CCardBody class="p-4">

          <!-- PASO 0 — Base de datos -->
          <template v-if="currentStep === 0">
            <h5 class="fw-semibold mb-1">Conexión a Base de Datos</h5>
            <p class="text-medium-emphasis small mb-3">Ingresa los datos de conexión a PostgreSQL 16.</p>
            <CAlert color="info" class="py-2 small mb-3">
              El usuario de base de datos debe tener permisos para crear schemas,
              tablas e índices (privilege: <strong>CREATE</strong> en la BD).
            </CAlert>
            <CRow class="g-3">
              <CCol :md="8">
                <CFormLabel class="fw-medium small">Host</CFormLabel>
                <CFormInput v-model="dbConfig.host" placeholder="localhost o IP del servidor"
                  @input="dbVerified = false; dbTestResult = null" />
              </CCol>
              <CCol :md="4">
                <CFormLabel class="fw-medium small">Puerto</CFormLabel>
                <CFormInput type="number" v-model="dbConfig.port" placeholder="5432"
                  @input="dbVerified = false; dbTestResult = null" />
              </CCol>
              <CCol :md="12">
                <CFormLabel class="fw-medium small">Nombre de la base de datos</CFormLabel>
                <CFormInput v-model="dbConfig.name" placeholder="icm_db"
                  @input="dbVerified = false; dbTestResult = null" />
              </CCol>
              <CCol :md="6">
                <CFormLabel class="fw-medium small">Usuario</CFormLabel>
                <CFormInput v-model="dbConfig.user" placeholder="icm_user" autocomplete="off"
                  @input="dbVerified = false; dbTestResult = null" />
              </CCol>
              <CCol :md="6">
                <CFormLabel class="fw-medium small">Contraseña</CFormLabel>
                <CFormInput type="password" v-model="dbConfig.password" placeholder="••••••••" autocomplete="new-password"
                  @input="dbVerified = false; dbTestResult = null" />
              </CCol>
              <CCol :md="12">
                <CFormCheck id="ssl" label="Activar SSL (recomendado en producción)" v-model="dbConfig.ssl"
                  @change="dbVerified = false; dbTestResult = null" />
              </CCol>
            </CRow>
            <CAlert v-if="dbTestResult" :color="dbTestResult.success ? 'success' : 'danger'"
              class="py-2 small mt-3 mb-0">{{ dbTestResult.message }}</CAlert>
            <div class="d-flex gap-2 mt-4">
              <CButton color="secondary" variant="outline" @click="handleTestDatabase"
                :disabled="dbTesting || !dbConfig.host || !dbConfig.name || !dbConfig.user">
                <CSpinner v-if="dbTesting" size="sm" class="me-2" />
                {{ dbTesting ? 'Probando...' : 'Probar conexión' }}
              </CButton>
              <CButton color="primary" class="ms-auto"
                @click="error = null; success = null; currentStep = 1" :disabled="!canProceedStep0">
                Siguiente →
              </CButton>
            </div>
          </template>

          <!-- PASO 1 — Master Key -->
          <template v-else-if="currentStep === 1">
            <h5 class="fw-semibold mb-1">Master Key de Cifrado</h5>
            <p class="text-medium-emphasis small mb-3">
              Esta clave cifra todas las credenciales almacenadas en la base de datos.
            </p>
            <CAlert color="warning" class="py-2 small mb-3">
              <strong>⚠ Advertencia crítica:</strong> Si pierdes la Master Key,
              <strong> no hay forma de recuperar las credenciales cifradas</strong>.
              Guárdala inmediatamente en un gestor de secretos externo.
            </CAlert>
            <CRow class="g-3">
              <CCol :md="12">
                <CFormLabel class="fw-medium small">Master Key (mínimo 32 caracteres)</CFormLabel>
                <div class="position-relative">
                  <CFormInput :type="showMasterKey ? 'text' : 'password'" v-model="masterKey"
                    placeholder="Ingresa o genera una clave segura"
                    style="padding-right: 76px; font-family: monospace; font-size: 13px"
                    @input="masterKeyEntropy = null; error = null" />
                  <CButton color="secondary" variant="ghost" size="sm" @click="handleCopyKey" :disabled="!masterKey"
                    :title="copiedKey ? 'Copiado' : 'Copiar'"
                    style="position:absolute;right:36px;top:50%;transform:translateY(-50%);padding:4px 6px">
                    <Check v-if="copiedKey" :size="15" style="color: var(--cui-success)" />
                    <Copy v-else :size="15" />
                  </CButton>
                  <CButton color="secondary" variant="ghost" size="sm" @click="showMasterKey = !showMasterKey"
                    :title="showMasterKey ? 'Ocultar' : 'Mostrar'"
                    style="position:absolute;right:4px;top:50%;transform:translateY(-50%);padding:4px 6px">
                    <EyeOff v-if="showMasterKey" :size="15" />
                    <Eye v-else :size="15" />
                  </CButton>
                </div>
                <div class="d-flex align-items-center gap-2 mt-2">
                  <span class="text-medium-emphasis small">{{ masterKey.length }} caracteres</span>
                  <CBadge v-if="masterKeyEntropy" :color="entropyColor">Entropía: {{ masterKeyEntropy }}</CBadge>
                </div>
              </CCol>
            </CRow>
            <CAlert v-if="error" color="danger" class="py-2 small mt-3 mb-0">{{ error }}</CAlert>
            <div class="d-flex gap-2 mt-4 flex-wrap">
              <CButton color="secondary" variant="outline"
                @click="error = null; success = null; currentStep = 0">
                <ArrowLeft :size="16" class="me-1" /> Atrás
              </CButton>
              <CButton color="secondary" variant="outline" @click="handleGenerateKey" :disabled="generatingKey">
                <CSpinner v-if="generatingKey" size="sm" class="me-2" />
                <template v-else><KeyRound :size="15" class="me-1" /> Generar clave segura</template>
              </CButton>
              <CButton color="secondary" variant="outline" @click="handleValidateKey()" :disabled="masterKey.length < 32">
                Validar entropía
              </CButton>
              <CButton color="secondary" variant="outline" @click="handleDownloadKey" :disabled="!masterKey"
                title="Descargar Master Key como .txt">
                <Download :size="15" class="me-1" /> Descargar
              </CButton>
              <CButton color="primary" class="ms-auto"
                @click="error = null; success = null; currentStep = 2" :disabled="!canProceedStep1">
                Siguiente →
              </CButton>
            </div>
          </template>

          <!-- PASO 2 — Usuario Administrador -->
          <template v-else-if="currentStep === 2">
            <h5 class="fw-semibold mb-1">Usuario Administrador</h5>
            <p class="text-medium-emphasis small mb-3">Crea el primer usuario con acceso total al sistema.</p>
            <CRow class="g-3">
              <CCol :md="12">
                <CFormLabel class="fw-medium small">Nombre completo</CFormLabel>
                <CFormInput v-model="adminUser.fullName" placeholder="Nombre Apellido" />
              </CCol>
              <CCol :md="6">
                <CFormLabel class="fw-medium small">Username <span class="text-medium-emphasis">(letras, números, _)</span></CFormLabel>
                <CFormInput v-model="adminUser.username" placeholder="admin" autocomplete="off" />
              </CCol>
              <CCol :md="6">
                <CFormLabel class="fw-medium small">Email</CFormLabel>
                <CFormInput type="email" v-model="adminUser.email" placeholder="admin@empresa.com" />
              </CCol>
              <CCol :md="6">
                <CFormLabel class="fw-medium small">Contraseña</CFormLabel>
                <div class="position-relative">
                  <CFormInput :type="showPassword ? 'text' : 'password'" v-model="adminUser.password"
                    placeholder="••••••••••••" autocomplete="new-password" style="padding-right: 72px" />
                  <CButton color="secondary" variant="ghost" size="sm"
                    @click="showPassword = !showPassword"
                    style="position:absolute;right:4px;top:50%;transform:translateY(-50%);padding:2px 8px">
                    {{ showPassword ? 'Ocultar' : 'Ver' }}
                  </CButton>
                </div>
                <div v-if="adminUser.password.length > 0" class="mt-2 p-2 rounded"
                  style="background: var(--cui-body-bg); border: 1px solid var(--cui-border-color)">
                  <div v-for="(check, key) in passwordChecks" :key="key"
                    class="d-flex align-items-center gap-2" style="font-size: 12px">
                    <span :style="{ color: check ? 'var(--cui-success)' : 'var(--cui-secondary)', fontWeight: 700 }">
                      <Check v-if="check" :size="13" />
                      <X v-else :size="13" />
                    </span>
                    <span :style="{ color: check ? 'var(--cui-success)' : 'var(--cui-body-color)' }">
                      {{ PASSWORD_LABELS[key] }}
                    </span>
                  </div>
                </div>
              </CCol>
              <CCol :md="6">
                <CFormLabel class="fw-medium small">Confirmar contraseña</CFormLabel>
                <CFormInput type="password" v-model="adminUser.confirmPassword"
                  placeholder="••••••••••••" autocomplete="new-password"
                  :style="{
                    borderColor: adminUser.confirmPassword.length > 0
                      ? adminUser.password === adminUser.confirmPassword ? 'var(--cui-success)' : 'var(--cui-danger)'
                      : undefined
                  }" />
                <div v-if="adminUser.confirmPassword.length > 0" class="small mt-1"
                  :style="{ color: adminUser.password === adminUser.confirmPassword ? 'var(--cui-success)' : 'var(--cui-danger)' }">
                  <template v-if="adminUser.password === adminUser.confirmPassword">
                    <Check :size="14" class="me-1" /> Las contraseñas coinciden
                  </template>
                  <template v-else>Las contraseñas no coinciden</template>
                </div>
              </CCol>
            </CRow>
            <CAlert v-if="error" color="danger" class="py-2 small mt-3 mb-0">{{ error }}</CAlert>
            <div class="d-flex gap-2 mt-4">
              <CButton color="secondary" variant="outline"
                @click="error = null; success = null; currentStep = 1">
                <ArrowLeft :size="16" class="me-1" /> Atrás
              </CButton>
              <CButton color="primary" class="ms-auto"
                @click="error = null; success = null; currentStep = 3" :disabled="!canProceedStep2">
                Siguiente →
              </CButton>
            </div>
          </template>

          <!-- PASO 3 — Confirmar e Instalar -->
          <template v-else-if="currentStep === 3">
            <h5 class="fw-semibold mb-1">Confirmar instalación</h5>
            <p class="text-medium-emphasis small mb-3">Revisa la configuración antes de instalar el sistema.</p>
            <CAlert v-if="!success" color="info" class="py-2 small mb-3">
              Al confirmar se ejecutarán las migraciones de base de datos,
              los seeds de catálogos y se creará el usuario administrador.
              Esta operación puede tardar unos segundos.
            </CAlert>
            <CTable v-if="!success" small bordered class="mb-3" style="font-size: 13px">
              <CTableBody>
                <CTableRow>
                  <CTableDataCell class="fw-medium text-medium-emphasis" style="width: 35%">Host BD</CTableDataCell>
                  <CTableDataCell><code>{{ dbConfig.host }}:{{ dbConfig.port }}</code></CTableDataCell>
                </CTableRow>
                <CTableRow>
                  <CTableDataCell class="fw-medium text-medium-emphasis">Base de datos</CTableDataCell>
                  <CTableDataCell><code>{{ dbConfig.name }}</code></CTableDataCell>
                </CTableRow>
                <CTableRow>
                  <CTableDataCell class="fw-medium text-medium-emphasis">Usuario BD</CTableDataCell>
                  <CTableDataCell><code>{{ dbConfig.user }}</code></CTableDataCell>
                </CTableRow>
                <CTableRow>
                  <CTableDataCell class="fw-medium text-medium-emphasis">SSL</CTableDataCell>
                  <CTableDataCell>
                    <CBadge :color="dbConfig.ssl ? 'success' : 'secondary'">{{ dbConfig.ssl ? 'Sí' : 'No' }}</CBadge>
                  </CTableDataCell>
                </CTableRow>
                <CTableRow>
                  <CTableDataCell class="fw-medium text-medium-emphasis">Master Key</CTableDataCell>
                  <CTableDataCell>
                    <span class="text-medium-emphasis me-2">******* (configurada)</span>
                    <CBadge v-if="masterKeyEntropy" :color="entropyColor">Entropía: {{ masterKeyEntropy }}</CBadge>
                  </CTableDataCell>
                </CTableRow>
                <CTableRow>
                  <CTableDataCell class="fw-medium text-medium-emphasis">Administrador</CTableDataCell>
                  <CTableDataCell><code>{{ adminUser.username }}</code></CTableDataCell>
                </CTableRow>
                <CTableRow>
                  <CTableDataCell class="fw-medium text-medium-emphasis">Email</CTableDataCell>
                  <CTableDataCell>{{ adminUser.email }}</CTableDataCell>
                </CTableRow>
              </CTableBody>
            </CTable>
            <CAlert v-if="success" color="success" class="py-3 mb-3">
              <div class="fw-semibold mb-1"><Check :size="14" class="me-1" /> {{ success }}</div>
              <div v-if="countdown !== null && countdown > 0" class="small text-medium-emphasis">
                Redirigiendo al login en <strong>{{ countdown }}</strong>...
              </div>
            </CAlert>
            <CAlert v-if="error" color="danger" class="py-2 small mb-3">{{ error }}</CAlert>
            <div v-if="!success" class="d-flex gap-2">
              <CButton color="secondary" variant="outline"
                @click="error = null; success = null; currentStep = 2" :disabled="loading">
                <ArrowLeft :size="16" class="me-1" /> Atrás
              </CButton>
              <CButton color="primary" class="ms-auto" @click="handleFinalize" :disabled="loading">
                <CSpinner v-if="loading" size="sm" class="me-2" />
                {{ loading ? 'Instalando...' : 'Instalar sistema' }}
              </CButton>
            </div>
          </template>

        </CCardBody>
      </CCard>

      <p class="text-center text-medium-emphasis small mt-3 mb-0">
        Sistema de uso interno — Acceso restringido
      </p>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed } from 'vue'
import { useRouter } from 'vue-router'
import { Check, X, ArrowLeft, KeyRound, Eye, EyeOff, Copy, Download } from 'lucide-vue-next'
import { setupApi } from '../../api/index.js'
import { copySecret } from '../../utils/clipboard.js'

const router = useRouter()

const STEP_LABELS = ['Base de datos', 'Master Key', 'Administrador', 'Confirmar']

const PASSWORD_LABELS = {
  minLength:    'Mínimo 12 caracteres',
  hasUppercase: 'Al menos una mayúscula',
  hasLowercase: 'Al menos una minúscula',
  hasNumber:    'Al menos un número',
  hasSpecial:   'Al menos un carácter especial',
}

// Token gate
const setupToken    = ref('')
const tokenVerified = ref(false)
const tokenError    = ref(null)

function handleTokenSubmit() {
  if (!setupToken.value.trim()) {
    tokenError.value = 'El token no puede estar vacío.'
    return
  }
  setupApi.setToken(setupToken.value.trim())
  tokenVerified.value = true
  tokenError.value = null
}

// Navegación
const currentStep = ref(0)
const loading     = ref(false)
const error       = ref(null)
const success     = ref(null)

// Paso 0: BD
const dbConfig = reactive({ host: '', port: '5432', name: '', user: '', password: '', ssl: false })
const dbVerified    = ref(false)
const dbTesting     = ref(false)
const dbTestResult  = ref(null)

// Paso 1: Master Key
const masterKey        = ref('')
const showMasterKey    = ref(false)
const masterKeyEntropy = ref(null)
const generatingKey    = ref(false)
const copiedKey        = ref(false)

// Paso 2: Admin
const adminUser = reactive({ username: '', email: '', fullName: '', password: '', confirmPassword: '' })
const showPassword = ref(false)

// Paso 3: countdown
const countdown = ref(null)

const passwordChecks = computed(() => ({
  minLength:    adminUser.password.length >= 12,
  hasUppercase: /[A-Z]/.test(adminUser.password),
  hasLowercase: /[a-z]/.test(adminUser.password),
  hasNumber:    /[0-9]/.test(adminUser.password),
  hasSpecial:   /[^A-Za-z0-9]/.test(adminUser.password),
}))

const isPasswordValid = computed(() => Object.values(passwordChecks.value).every(Boolean))

const canProceedStep0 = computed(() => dbVerified.value)
const canProceedStep1 = computed(() => masterKey.value.length >= 32 && masterKeyEntropy.value !== null)
const canProceedStep2 = computed(() =>
  adminUser.username.trim().length >= 3 &&
  adminUser.email.trim().length > 0 &&
  adminUser.fullName.trim().length > 0 &&
  isPasswordValid.value &&
  adminUser.password === adminUser.confirmPassword
)

const entropyColor = computed(() =>
  masterKeyEntropy.value === 'alta' ? 'success' :
  masterKeyEntropy.value === 'media' ? 'warning' : 'danger'
)

const progressValue = computed(() => (currentStep.value / 3) * 100)

async function handleTestDatabase() {
  error.value = null; success.value = null
  dbTesting.value = true; dbVerified.value = false; dbTestResult.value = null
  try {
    // Un fallo de conexión llega como 200 con success: false, no como excepción.
    const result = await setupApi.testDatabase(dbConfig)
    dbTestResult.value = { success: result.success === true, message: result.message }
    dbVerified.value = result.success === true
  } catch (err) {
    dbTestResult.value = { success: false, message: err.message || 'Error al probar la conexión.' }
    dbVerified.value = false
  } finally { dbTesting.value = false }
}

async function handleGenerateKey() {
  error.value = null; success.value = null
  generatingKey.value = true
  try {
    const result = await setupApi.generateKey()
    masterKey.value = result.masterKey
    masterKeyEntropy.value = result.entropy
  } catch (err) {
    error.value = err.message || 'Error al generar la clave.'
  } finally { generatingKey.value = false }
}

// No se vacia el portapapeles despues: el operador todavia tiene que pegar la
// Master Key en su gestor de secretos, y perderla significa no poder descifrar
// ninguna credencial.
async function handleCopyKey() {
  if (!masterKey.value) return
  const ok = await copySecret(masterKey.value)
  if (!ok) {
    error.value = 'No se pudo copiar al portapapeles. Copia la clave manualmente o descargala.'
    return
  }
  copiedKey.value = true
  setTimeout(() => { copiedKey.value = false }, 2000)
}

function handleDownloadKey() {
  if (!masterKey.value) return
  const content = [
    'infra-credentials-manager — Master Key',
    '═'.repeat(50),
    '',
    `Generada el: ${new Date().toLocaleString()}`,
    '',
    'MASTER KEY:',
    masterKey.value,
    '',
    '⚠ ADVERTENCIA: Guarda este archivo en un lugar seguro.',
    '  Si pierdes esta clave no podrás recuperar las credenciales.',
    '  Elimina este archivo después de guardarlo en tu gestor de secretos.',
  ].join('\n')
  const blob = new Blob([content], { type: 'text/plain' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = `icm-master-key-${Date.now()}.txt`; a.click()
  URL.revokeObjectURL(url)
}

async function handleValidateKey(keyToValidate) {
  const key = keyToValidate ?? masterKey.value
  if (!key || key.length < 32) { masterKeyEntropy.value = null; return }
  error.value = null; success.value = null
  try {
    const result = await setupApi.validateKey({ masterKey: key })
    masterKeyEntropy.value = result.entropy || null
  } catch (err) {
    masterKeyEntropy.value = null
    error.value = err.message || 'Error al validar la clave.'
  }
}

async function handleFinalize() {
  error.value = null; success.value = null
  if (adminUser.password !== adminUser.confirmPassword) {
    error.value = 'Las contraseñas no coinciden.'; return
  }
  if (!isPasswordValid.value) {
    error.value = 'La contraseña no cumple todos los requisitos.'; return
  }
  loading.value = true
  try {
    await setupApi.finalize({
      dbConfig,
      masterKey: masterKey.value,
      adminUser: {
        username: adminUser.username,
        email:    adminUser.email,
        fullName: adminUser.fullName,
        password: adminUser.password,
      },
      appPort: 8743,
    })
    success.value = '¡Sistema instalado correctamente!'
    let count = 3
    countdown.value = count
    const timer = setInterval(() => {
      count -= 1
      countdown.value = count
      if (count <= 0) { clearInterval(timer); router.replace('/login') }
    }, 1000)
  } catch (err) {
    error.value = err.message || 'Error durante la instalación. Revisa los logs del servidor.'
  } finally { loading.value = false }
}
</script>
