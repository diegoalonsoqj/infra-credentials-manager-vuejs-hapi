<!--
  MfaCard.vue — Segundo factor (TOTP) en "Mi perfil".

  Activación: el backend entrega el secreto y la URI otpauth; el QR se dibuja
  aquí (el secreto no se guarda en ningún sitio del navegador). Los códigos de
  recuperación se muestran una sola vez, al activar o al regenerarlos.
-->
<template>
  <CCard class="shadow-sm mb-4">
    <CCardHeader class="py-2 d-flex align-items-center gap-2">
      <span class="fw-semibold small">Segundo factor de autenticación</span>
      <CBadge v-if="mfa.enabled" color="success">Activado</CBadge>
      <CBadge v-else-if="mfa.required" color="danger">Obligatorio — sin activar</CBadge>
      <CBadge v-else color="secondary">Desactivado</CBadge>
    </CCardHeader>
    <CCardBody>
      <CAlert v-if="error" color="danger" class="py-2 small">{{ error }}</CAlert>
      <CAlert v-if="ok" color="success" class="py-2 small">{{ ok }}</CAlert>

      <!-- Códigos de recuperación: se ven una sola vez -->
      <template v-if="recoveryCodes">
        <CAlert color="warning" class="py-2 small">
          <strong>Guarda estos {{ recoveryCodes.length }} códigos de recuperación ahora.</strong>
          Sirven para entrar si pierdes el móvil, cada uno una sola vez, y no se vuelven a mostrar.
        </CAlert>
        <div class="d-flex flex-wrap gap-2 mb-3">
          <code v-for="c in recoveryCodes" :key="c" class="border rounded px-2 py-1">{{ c }}</code>
        </div>
        <CButton color="secondary" variant="outline" size="sm" class="me-2" @click="copiarCodigos">
          {{ copiado ? 'Copiados' : 'Copiar códigos' }}
        </CButton>
        <CButton color="primary" size="sm" @click="recoveryCodes = null">Ya los guardé</CButton>
      </template>

      <!-- Activación en curso -->
      <template v-else-if="setup">
        <p class="small mb-2">
          Escanea este código con tu aplicación de autenticación (Aegis, Google Authenticator…)
          y escribe el código de 6 dígitos que aparezca.
        </p>
        <div class="d-flex flex-wrap gap-3 align-items-start">
          <img v-if="qr" :src="qr" alt="Código QR para la aplicación de autenticación" width="180" height="180"
            style="border: 1px solid var(--cui-border-color); border-radius: 6px" />
          <div>
            <p class="small text-medium-emphasis mb-1">¿No puedes escanearlo? Introduce la clave a mano:</p>
            <code class="d-block mb-3" style="word-break: break-all">{{ setup.secret }}</code>
            <form class="d-flex gap-2 align-items-start" @submit.prevent="activar">
              <CFormInput v-model="code" placeholder="000000" inputmode="numeric" required
                style="width: 130px; font-family: monospace; letter-spacing: 2px" />
              <CButton color="primary" type="submit" :disabled="saving || !code">
                <CSpinner v-if="saving" size="sm" /><template v-else>Activar</template>
              </CButton>
              <CButton color="secondary" variant="outline" @click="cancelar">Cancelar</CButton>
            </form>
          </div>
        </div>
      </template>

      <!-- Estado normal -->
      <template v-else>
        <p class="small text-medium-emphasis mb-3">
          <template v-if="mfa.enabled">
            Al entrar se te pedirá un código de tu aplicación de autenticación.
            Te quedan <strong>{{ mfa.recoveryCodesLeft }}</strong> códigos de recuperación sin usar.
          </template>
          <template v-else-if="mfa.required">
            La política del sistema exige segundo factor para tu cuenta: hasta que lo actives solo
            podrás usar esta pantalla.
          </template>
          <template v-else>
            Añade un código temporal de tu móvil además de la contraseña.
          </template>
        </p>

        <CButton v-if="!mfa.enabled" color="primary" size="sm" :disabled="saving" @click="empezar">
          <CSpinner v-if="saving" size="sm" /><template v-else>Activar segundo factor</template>
        </CButton>

        <template v-else>
          <!-- Desactivar o regenerar exigen contraseña y código: una sesión robada no basta -->
          <form class="row g-2 align-items-end" @submit.prevent>
            <CCol :md="4">
              <CFormLabel class="small fw-semibold">Contraseña</CFormLabel>
              <CFormInput v-model="password" type="password" autocomplete="current-password" />
            </CCol>
            <CCol :md="3">
              <CFormLabel class="small fw-semibold">Código</CFormLabel>
              <CFormInput v-model="code" placeholder="000000" style="font-family: monospace" />
            </CCol>
            <CCol :md="5" class="d-flex gap-2">
              <CButton color="secondary" variant="outline" size="sm" :disabled="saving || !password || !code"
                @click="regenerar">
                Nuevos códigos de recuperación
              </CButton>
              <CButton v-if="!mfa.required" color="danger" variant="outline" size="sm"
                :disabled="saving || !password || !code" @click="desactivar">
                Desactivar
              </CButton>
            </CCol>
          </form>
        </template>
      </template>
    </CCardBody>
  </CCard>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import QRCode from 'qrcode'
import api from '../../api/index.js'
import { copySecret } from '../../utils/clipboard.js'

const mfa = ref({ enabled: false, required: false, recoveryCodesLeft: 0 })
const setup = ref(null)
const qr = ref(null)
const recoveryCodes = ref(null)
const code = ref('')
const password = ref('')
const saving = ref(false)
const copiado = ref(false)
const error = ref(null)
const ok = ref(null)

async function cargar() {
  try { mfa.value = (await api.get('/profile/mfa')).mfa } catch (err) { error.value = err?.message || 'Error al cargar el estado.' }
}

function limpiar() { error.value = null; ok.value = null }
function cancelar() { setup.value = null; qr.value = null; code.value = ''; limpiar() }

async function empezar() {
  limpiar(); saving.value = true
  try {
    setup.value = await api.post('/profile/mfa/setup')
    qr.value = await QRCode.toDataURL(setup.value.otpauthUri, { margin: 1, width: 360 })
  } catch (err) { error.value = err?.message || 'No se pudo iniciar la activación.' }
  finally { saving.value = false }
}

async function activar() {
  limpiar(); saving.value = true
  try {
    recoveryCodes.value = (await api.post('/profile/mfa/enable', { code: code.value.trim() })).recoveryCodes
    setup.value = null; qr.value = null; code.value = ''
    ok.value = 'Segundo factor activado.'
    await cargar()
  } catch (err) { error.value = err?.message || 'No se pudo activar.' }
  finally { saving.value = false }
}

async function regenerar() {
  limpiar(); saving.value = true
  try {
    recoveryCodes.value = (await api.post('/profile/mfa/recovery-codes', { password: password.value, code: code.value.trim() })).recoveryCodes
    password.value = ''; code.value = ''
    await cargar()
  } catch (err) { error.value = err?.message || 'No se pudieron regenerar los códigos.' }
  finally { saving.value = false }
}

async function desactivar() {
  limpiar(); saving.value = true
  try {
    await api.post('/profile/mfa/disable', { password: password.value, code: code.value.trim() })
    password.value = ''; code.value = ''
    ok.value = 'Segundo factor desactivado.'
    await cargar()
  } catch (err) { error.value = err?.message || 'No se pudo desactivar.' }
  finally { saving.value = false }
}

async function copiarCodigos() {
  copiado.value = await copySecret(recoveryCodes.value.join('\n'))
}

onMounted(cargar)
</script>
