<!--
  NetworkDeviceForm.vue — Formulario de alta y edición de dispositivo de red.
  Mismos campos que un servidor o un servicio de BD: nombre, IP o host, puerto,
  ambiente e infraestructura. Lo propio es el producto de red (catálogo).
-->
<template>
  <div>
    <CAlert v-if="error" color="danger" class="py-2 small mb-3">{{ error }}</CAlert>
    <CRow class="g-3">
      <CCol v-if="isEdit" :md="4">
        <CFormLabel class="fw-medium small text-medium-emphasis">Código (sistema)</CFormLabel>
        <CFormInput :value="initial.code" disabled style="background: var(--cui-tertiary-bg); font-family: monospace" />
      </CCol>
      <CCol :md="isEdit ? 8 : 12">
        <CFormLabel class="fw-medium small">Nombre <span class="text-danger">*</span></CFormLabel>
        <CFormInput v-model="form.name" placeholder="Firewall perimetral sede central" />
      </CCol>
      <CCol :md="8">
        <CFormLabel class="fw-medium small">IP o host <span class="text-danger">*</span></CFormLabel>
        <CFormInput v-model="form.host" placeholder="10.0.0.1 o fw01.empresa.local" style="font-family: monospace" />
      </CCol>
      <CCol :md="4">
        <CFormLabel class="fw-medium small">Puerto</CFormLabel>
        <CFormInput type="number" :min="1" :max="65535" v-model="form.port" placeholder="22, 443…" />
        <div class="text-medium-emphasis" style="font-size: 11px; margin-top: 2px">
          Vacío: el habitual del acceso (SSH 22, HTTPS 443…)
        </div>
      </CCol>
      <CCol :md="4">
        <CFormLabel class="fw-medium small">Ambiente <span class="text-danger">*</span></CFormLabel>
        <CFormSelect v-model="form.environmentId">
          <option value="">— Seleccionar —</option>
          <option v-for="e in catalogs.environments" :key="e.id" :value="String(e.id)">{{ e.name }} ({{ e.code }})</option>
        </CFormSelect>
      </CCol>
      <CCol :md="4">
        <CFormLabel class="fw-medium small">Infraestructura</CFormLabel>
        <CFormSelect v-model="form.infrastructureId">
          <option value="">— Sin especificar —</option>
          <option v-for="i in catalogs.infrastructures" :key="i.id" :value="String(i.id)">{{ i.name }} ({{ i.code }})</option>
        </CFormSelect>
      </CCol>
      <CCol :md="4">
        <CFormLabel class="fw-medium small">Producto de red</CFormLabel>
        <CFormSelect v-model="form.productId">
          <option value="">— Sin especificar —</option>
          <option v-for="p in catalogs.networkProducts" :key="p.id" :value="String(p.id)">{{ p.name }}</option>
        </CFormSelect>
      </CCol>
      <CCol :md="12">
        <CFormLabel class="fw-medium small">Descripción</CFormLabel>
        <CFormTextarea :rows="2" v-model="form.description"
          placeholder="Modelo, ubicación, otros accesos (p. ej. web por el 8443)…" />
      </CCol>
    </CRow>
    <div class="d-flex gap-2 mt-4">
      <CButton color="secondary" variant="outline" @click="emit('cancel')" :disabled="loading">Cancelar</CButton>
      <CButton color="primary" class="ms-auto" @click="emit('save', form)" :disabled="loading || !isValid">
        <CSpinner v-if="loading" size="sm" class="me-2" />
        <template v-if="isEdit">{{ loading ? 'Guardando...' : 'Guardar cambios' }}</template>
        <template v-else>{{ loading ? 'Creando...' : 'Crear dispositivo' }}</template>
      </CButton>
    </div>
  </div>
</template>

<script>
import { reactive, computed, defineComponent } from 'vue'

export default defineComponent({
  name: 'NetworkDeviceForm',
  props: {
    initial:  { type: Object,  default: () => ({}) },
    catalogs: { type: Object,  required: true },
    loading:  { type: Boolean, default: false },
    error:    { type: String,  default: null },
  },
  emits: ['save', 'cancel'],
  setup(props, { emit }) {
    const isEdit = computed(() => !!props.initial?.id)

    const form = reactive({
      name:             props.initial?.name              || '',
      host:             props.initial?.host              || '',
      port:             props.initial?.port              ? String(props.initial.port)              : '',
      environmentId:    props.initial?.environment_id    ? String(props.initial.environment_id)    : '',
      infrastructureId: props.initial?.infrastructure_id ? String(props.initial.infrastructure_id) : '',
      productId:        props.initial?.product_id        ? String(props.initial.product_id)        : '',
      description:      props.initial?.description       || '',
    })

    const portValid = computed(() => {
      if (form.port === '' || form.port === null) return true
      const n = Number(form.port)
      return Number.isInteger(n) && n >= 1 && n <= 65535
    })
    const isValid = computed(() => form.name.trim() && form.host.trim() && form.environmentId && portValid.value)

    return { form, isEdit, isValid, emit }
  },
})
</script>
