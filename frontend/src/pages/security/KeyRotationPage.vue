<template>
  <div v-if="loading" style="height: 100%; display: flex; justify-content: center; align-items: center">
    <CSpinner color="primary" />
  </div>

  <div v-else class="bg-body-tertiary py-4" style="height: 100%; overflow-y: auto">
    <CContainer style="max-width: 800px">

      <CAlert color="danger" class="mb-4">
        <strong>Operación crítica e irreversible.</strong> Al rotar la Master Key, todas las
        credenciales del sistema son re-cifradas atómicamente. La clave anterior queda
        invalidada. Asegúrate de guardar la nueva clave en un lugar seguro antes de continuar.
      </CAlert>

      <CAlert v-if="statusError" color="danger">{{ statusError }}</CAlert>
      <CAlert v-if="rotateResult" color="success" class="mb-4">
        <Check :size="14" class="me-1" /> Rotación completada.
        <strong>{{ rotateResult.credentials_recrypted }}</strong> credencial(es) re-cifrada(s) con la nueva clave.
      </CAlert>

      <template v-if="status">

        <!-- Estado actual -->
        <CCard class="shadow-sm mb-4">
          <CCardHeader class="py-2">
            <span class="fw-semibold small">Estado actual de la Master Key</span>
          </CCardHeader>
          <CCardBody>
            <CRow v-if="status.active" class="g-3">
              <CCol :md="4">
                <div class="small text-medium-emphasis mb-1">Alias</div>
                <div class="fw-semibold">{{ status.active.key_alias }}</div>
              </CCol>
              <CCol :md="4">
                <div class="small text-medium-emphasis mb-1">Hash (preview)</div>
                <code style="font-size: 12px">{{ status.active.key_hash_preview }}</code>
              </CCol>
              <CCol :md="4">
                <div class="small text-medium-emphasis mb-1">Proveedor</div>
                <CBadge color="secondary">{{ status.active.kms_provider }}</CBadge>
              </CCol>
              <CCol :md="4">
                <div class="small text-medium-emphasis mb-1">Activa desde</div>
                <div style="font-size: 13px">{{ new Date(status.active.created_at).toLocaleString('es-PE') }}</div>
              </CCol>
              <CCol :md="4">
                <div class="small text-medium-emphasis mb-1">Credenciales afectadas</div>
                <div class="fw-semibold">{{ status.credentials_to_reencrypt }}</div>
              </CCol>
              <CCol :md="4">
                <div class="small text-medium-emphasis mb-1">Sincronía env ↔ BD</div>
                <CBadge v-if="status.active.env_key_matches_db" color="success">
                  Sincronizadas <Check :size="14" class="ms-1" />
                </CBadge>
                <CBadge v-else color="danger">¡Desincronizadas!</CBadge>
              </CCol>
              <CCol v-if="!status.active.env_key_matches_db" :md="12">
                <CAlert color="danger" class="py-2 mb-0 small">
                  La clave en el archivo <code>.env</code> no coincide con el hash registrado en la base de datos.
                  El sistema podría fallar al descifrar credenciales. Verifica y corrige antes de continuar.
                </CAlert>
              </CCol>
            </CRow>
            <p v-else class="text-medium-emphasis small mb-0">No se encontró una Master Key activa.</p>
          </CCardBody>
        </CCard>

        <!-- Formulario rotación -->
        <CCard class="shadow-sm mb-4">
          <CCardHeader class="py-2">
            <span class="fw-semibold small">Nueva rotación</span>
          </CCardHeader>
          <CCardBody>
            <CRow class="g-3">
              <CCol :md="12">
                <CFormLabel class="small fw-semibold">
                  Clave actual <span class="text-medium-emphasis">(confirmación)</span>
                </CFormLabel>
                <CInputGroup size="sm">
                  <CFormInput :type="showCurrentKey ? 'text' : 'password'"
                    placeholder="Pega la clave actual para confirmar"
                    v-model="currentKeyConfirm"
                    style="font-family: monospace" />
                  <CButton color="secondary" variant="outline" type="button"
                    @click="showCurrentKey = !showCurrentKey">
                    <EyeOff v-if="showCurrentKey" :size="16" /><Eye v-else :size="16" />
                  </CButton>
                </CInputGroup>
                <div class="text-medium-emphasis mt-1" style="font-size: 11px">
                  La clave actual se verifica en el servidor. No se envía al log.
                </div>
              </CCol>

              <CCol :md="12">
                <CFormLabel class="small fw-semibold">Nueva Master Key</CFormLabel>
                <CInputGroup size="sm">
                  <CFormInput :type="showNewKey ? 'text' : 'password'"
                    placeholder="Mínimo 32 caracteres con alta entropía"
                    v-model="newKey"
                    style="font-family: monospace" />
                  <CButton color="secondary" variant="outline" type="button"
                    @click="showNewKey = !showNewKey">
                    <EyeOff v-if="showNewKey" :size="16" /><Eye v-else :size="16" />
                  </CButton>
                  <CButton color="primary" variant="outline" type="button"
                    @click="handleGenerate" :disabled="generating">
                    <CSpinner v-if="generating" size="sm" /><template v-else>⚡ Generar</template>
                  </CButton>
                </CInputGroup>

                <!-- Indicador de entropía -->
                <div v-if="newKey" class="mt-2">
                  <div style="height: 5px; background: var(--cui-secondary-bg); border-radius: 3px; overflow: hidden; margin-bottom: 5px">
                    <div :style="{
                      height: '100%',
                      width: entropy.pct + '%',
                      background: `var(--cui-${entropy.color})`,
                      borderRadius: '3px',
                      transition: 'width 0.3s',
                    }" />
                  </div>
                  <div class="d-flex align-items-center gap-2" style="font-size: 12px">
                    <CBadge :color="entropy.color">Entropía {{ entropy.level }}</CBadge>
                    <span v-if="entropy.level !== 'alta'" class="text-danger">
                      La rotación requiere entropía alta (≥32 chars, mayúsculas, minúsculas, números y símbolos)
                    </span>
                    <span v-if="newKey === currentKeyConfirm && currentKeyConfirm" class="text-danger">
                      La nueva clave no puede ser igual a la actual
                    </span>
                  </div>
                </div>
              </CCol>

              <CCol :md="12">
                <CButton color="danger" :disabled="!canSubmit" @click="handleOpenConfirm">
                  Iniciar rotación
                </CButton>
              </CCol>
            </CRow>
          </CCardBody>
        </CCard>

        <!-- Historial -->
        <CCard v-if="status.history.length > 0" class="shadow-sm">
          <CCardHeader class="py-2">
            <span class="fw-semibold small">Historial de rotaciones</span>
          </CCardHeader>
          <CCardBody class="p-0">
            <CTable small hover responsive class="mb-0" style="font-size: 13px">
              <CTableHead>
                <CTableRow>
                  <CTableHeaderCell>Alias</CTableHeaderCell>
                  <CTableHeaderCell>Activa desde</CTableHeaderCell>
                  <CTableHeaderCell>Rotada</CTableHeaderCell>
                  <CTableHeaderCell>Credenciales re-cifradas</CTableHeaderCell>
                </CTableRow>
              </CTableHead>
              <CTableBody>
                <CTableRow v-for="h in status.history" :key="h.id">
                  <CTableDataCell class="text-medium-emphasis">{{ h.key_alias }}</CTableDataCell>
                  <CTableDataCell class="text-medium-emphasis">
                    {{ new Date(h.created_at).toLocaleString('es-PE') }}
                  </CTableDataCell>
                  <CTableDataCell class="text-medium-emphasis">
                    {{ h.rotated_at ? new Date(h.rotated_at).toLocaleString('es-PE') : '—' }}
                  </CTableDataCell>
                  <CTableDataCell>{{ h.credentials_recrypted ?? '—' }}</CTableDataCell>
                </CTableRow>
              </CTableBody>
            </CTable>
          </CCardBody>
        </CCard>

      </template>
    </CContainer>

    <!-- Modal confirmación -->
    <CModal :visible="showConfirm" @close="!rotating && (showConfirm = false)" backdrop="static">
      <CModalHeader>
        <CModalTitle>⚠ Confirmar rotación de Master Key</CModalTitle>
      </CModalHeader>
      <CModalBody>
        <CAlert v-if="rotateError" color="danger" class="py-2 small">{{ rotateError }}</CAlert>
        <CAlert color="warning" class="small">
          <strong>Esta operación:</strong>
          <ul class="mb-0 mt-1">
            <li>Re-cifrará <strong>{{ status?.credentials_to_reencrypt ?? '?' }}</strong> credencial(es) con la nueva clave.</li>
            <li>Invalidará permanentemente la clave anterior.</li>
            <li>Actualizará el archivo <code>.env</code> del servidor.</li>
            <li>Es atómica — si falla, se hace rollback completo.</li>
          </ul>
        </CAlert>
        <div class="form-check">
          <input id="understood" type="checkbox" class="form-check-input" v-model="understood" />
          <label for="understood" class="form-check-label" style="font-size: 14px">
            Entiendo el impacto de esta operación y he guardado la nueva clave en un lugar seguro.
          </label>
        </div>
      </CModalBody>
      <CModalFooter>
        <CButton color="secondary" variant="outline" @click="showConfirm = false" :disabled="rotating">
          Cancelar
        </CButton>
        <CButton color="danger" @click="handleRotate" :disabled="!understood || rotating">
          <CSpinner v-if="rotating" size="sm" class="me-2" />Re-cifrando credenciales…
          <template v-if="!rotating">Confirmar rotación</template>
        </CButton>
      </CModalFooter>
    </CModal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { Check, Eye, EyeOff } from 'lucide-vue-next'
import api from '../../api/index.js'

const status      = ref(null)
const loading     = ref(true)
const statusError = ref(null)

const currentKeyConfirm = ref('')
const newKey            = ref('')
const showCurrentKey    = ref(false)
const showNewKey        = ref(false)
const generating        = ref(false)

const showConfirm  = ref(false)
const understood   = ref(false)
const rotating     = ref(false)
const rotateError  = ref(null)
const rotateResult = ref(null)

function entropyLevel(key) {
  if (!key || key.length < 32) return { level: 'baja', color: 'danger', pct: 15 }
  let size = 0
  if (/[a-z]/.test(key)) size += 26
  if (/[A-Z]/.test(key)) size += 26
  if (/[0-9]/.test(key)) size += 10
  if (/[^a-zA-Z0-9]/.test(key)) size += 32
  const bits = key.length * Math.log2(size || 1)
  if (bits >= 160) return { level: 'alta',  color: 'success', pct: 100 }
  if (bits >= 100) return { level: 'media', color: 'warning', pct: 55  }
  return               { level: 'baja',  color: 'danger',  pct: 25  }
}

const entropy   = computed(() => entropyLevel(newKey.value))
const canSubmit = computed(() =>
  currentKeyConfirm.value && newKey.value &&
  entropy.value.level === 'alta' &&
  newKey.value !== currentKeyConfirm.value
)

async function loadStatus() {
  loading.value = true; statusError.value = null
  try {
    status.value = await api.get('/security/key-status')
  } catch (err) {
    statusError.value = err?.message || 'Error al cargar el estado de la Master Key.'
  } finally {
    loading.value = false
  }
}

async function handleGenerate() {
  generating.value = true
  try {
    const data = await api.post('/security/generate-key')
    newKey.value = data.key || ''
    showNewKey.value = true
  } catch (err) {
    rotateError.value = err?.message || 'Error al generar la clave.'
  } finally {
    generating.value = false
  }
}

function handleOpenConfirm() {
  rotateError.value = null
  understood.value = false
  showConfirm.value = true
}

async function handleRotate() {
  if (!understood.value) return
  rotating.value = true; rotateError.value = null
  try {
    const data = await api.post('/security/rotate-key', {
      newKey: newKey.value,
      currentKeyConfirm: currentKeyConfirm.value,
    })
    rotateResult.value = data
    showConfirm.value = false
    currentKeyConfirm.value = ''
    newKey.value = ''
    await loadStatus()
  } catch (err) {
    rotateError.value = err?.message || 'Error durante la rotación.'
  } finally {
    rotating.value = false
  }
}

onMounted(loadStatus)
</script>
