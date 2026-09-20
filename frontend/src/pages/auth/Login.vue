<template>
  <div class="bg-body-tertiary min-vh-100 d-flex align-items-center">
    <CContainer>
      <CRow class="justify-content-center">
        <CCol :md="5">
          <CCard class="shadow-sm">
            <CCardBody class="p-4">

              <div class="text-center mb-4">
                <div style="width: 56px; height: 56px; border-radius: 12px; background: var(--cui-primary); display: inline-flex; align-items: center; justify-content: center; margin-bottom: 12px">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
                    <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 4l5 2.18V11c0 3.5-2.33 6.79-5 7.93C9.33 17.79 7 14.5 7 11V7.18L12 5z"/>
                  </svg>
                </div>
                <h4 class="mb-1 fw-semibold">ICM</h4>
                <p class="text-medium-emphasis small mb-0">Gestión de Credenciales de Infraestructura</p>
              </div>

              <CAlert v-if="error" color="danger" class="mb-3 py-2 small">
                {{ error }}
              </CAlert>

              <CAlert v-if="aviso" color="warning" class="mb-3 py-2 small">
                {{ aviso }}
              </CAlert>

              <CForm v-if="!mfaToken" @submit.prevent="handleSubmit">
                <div class="mb-3">
                  <CFormLabel for="username" class="fw-medium">Usuario</CFormLabel>
                  <CFormInput
                    id="username"
                    type="text"
                    v-model="username"
                    placeholder="nombre de usuario"
                    autocomplete="username"
                    autofocus
                    required
                  />
                </div>

                <div class="mb-4">
                  <CFormLabel for="password" class="fw-medium">Contraseña</CFormLabel>
                  <CFormInput
                    id="password"
                    type="password"
                    v-model="password"
                    placeholder="••••••••••••"
                    autocomplete="current-password"
                    required
                  />
                </div>

                <CButton
                  type="submit"
                  color="primary"
                  class="w-100"
                  :disabled="loading || !username || !password"
                >
                  <template v-if="loading">
                    <CSpinner size="sm" class="me-2" />Iniciando sesión...
                  </template>
                  <template v-else>Iniciar sesión</template>
                </CButton>
              </CForm>

              <!-- Segundo paso: código de la aplicación de autenticación -->
              <CForm v-else @submit.prevent="handleMfaSubmit">
                <p class="small text-medium-emphasis mb-3">
                  Escribe el código de 6 dígitos de tu aplicación de autenticación
                  (Aegis, Google Authenticator…) para <strong>{{ username }}</strong>.
                </p>
                <div class="mb-3">
                  <CFormLabel for="code" class="fw-medium">
                    {{ usarRecuperacion ? 'Código de recuperación' : 'Código de verificación' }}
                  </CFormLabel>
                  <CFormInput
                    id="code"
                    v-model="code"
                    :placeholder="usarRecuperacion ? 'XXXXX-XXXXX' : '000000'"
                    :inputmode="usarRecuperacion ? 'text' : 'numeric'"
                    autocomplete="one-time-code"
                    autofocus
                    required
                    style="font-family: monospace; letter-spacing: 2px"
                  />
                </div>
                <CButton type="submit" color="primary" class="w-100" :disabled="loading || !code">
                  <template v-if="loading"><CSpinner size="sm" class="me-2" />Verificando...</template>
                  <template v-else>Verificar</template>
                </CButton>
                <div class="d-flex justify-content-between mt-3">
                  <CButton color="secondary" variant="ghost" size="sm" @click="usarRecuperacion = !usarRecuperacion; code = ''">
                    {{ usarRecuperacion ? 'Usar código de la aplicación' : 'Usar código de recuperación' }}
                  </CButton>
                  <CButton color="secondary" variant="ghost" size="sm" @click="volver">Cancelar</CButton>
                </div>
              </CForm>

              <p class="text-center text-medium-emphasis small mt-4 mb-0">
                Sistema de uso interno. Acceso restringido.
              </p>
            </CCardBody>
          </CCard>
        </CCol>
      </CRow>
    </CContainer>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '../../api/index.js'
import { useAuthStore } from '../../store/authStore.js'

const router    = useRouter()
const authStore = useAuthStore()

const username = ref('')
const password = ref('')
const loading  = ref(false)
const error    = ref(null)

// Segundo factor: con el token que devuelve el login, la pantalla pasa a pedir
// el código. El token vive solo en memoria y caduca a los 5 minutos.
const mfaToken = ref(null)
const code     = ref('')
const usarRecuperacion = ref(false)
const aviso = ref(new URLSearchParams(window.location.search).get('motivo') === 'inactividad'
  ? 'Tu sesión se cerró por inactividad. Vuelve a iniciar sesión.'
  : null)

function volver() {
  mfaToken.value = null; code.value = ''; password.value = ''; error.value = null; usarRecuperacion.value = false
}

async function handleSubmit() {
  error.value = null
  loading.value = true
  try {
    const data = await api.post('/auth/login', { username: username.value, password: password.value })
    if (data.mfaRequired) {
      mfaToken.value = data.mfaToken
      aviso.value = null
      return
    }
    entrar(data)
  } catch (err) {
    error.value = err?.message || 'Error al iniciar sesión.'
  } finally {
    loading.value = false
  }
}

async function handleMfaSubmit() {
  error.value = null
  loading.value = true
  try {
    entrar(await api.post('/auth/mfa', { mfaToken: mfaToken.value, code: code.value.trim() }))
  } catch (err) {
    error.value = err?.message || 'Error al verificar el código.'
    code.value = ''
    // Token caducado o inválido: se vuelve al primer paso.
    if (/caduc/i.test(err?.message || '')) mfaToken.value = null
  } finally {
    loading.value = false
  }
}

function entrar(data) {
  authStore.login(data.user)
  router.replace('/dashboard')
}
</script>
