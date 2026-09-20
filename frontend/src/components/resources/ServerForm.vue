<!--
  ServerForm.vue — Formulario de alta y edición de servidor.

  Extraído de ServersPage.vue, donde vivía como plantilla en string.
  Eso exigía el compilador de Vue en el navegador (new Function()), que la CSP
  del backend bloquea (script-src 'self', sin unsafe-eval) y dejaba la página en
  blanco en producción. Como SFC, Vite lo compila en el build.
-->
<template>
  <div>
    <CAlert v-if="error" color="danger" class="py-2 small mb-3">{{ error }}</CAlert>
    <CRow class="g-3">
      <CCol v-if="isEdit" :md="4">
        <CFormLabel class="fw-medium small text-medium-emphasis">Código (sistema)</CFormLabel>
        <CFormInput :value="initial.code" disabled style="background: var(--cui-tertiary-bg); font-family: monospace" />
      </CCol>
      <CCol :md="isEdit ? 4 : 6">
        <CFormLabel class="fw-medium small">Hostname <span class="text-danger">*</span></CFormLabel>
        <CFormInput v-model="form.hostname" placeholder="tauro.empresa.com" style="font-family: monospace" />
      </CCol>
      <CCol :md="isEdit ? 4 : 6">
        <CFormLabel class="fw-medium small">Dirección IP</CFormLabel>
        <CFormInput v-model="form.ipAddress" placeholder="10.0.0.1" style="font-family: monospace" />
      </CCol>
      <CCol :md="12">
        <CFormLabel class="fw-medium small">Nombre descriptivo <span class="text-danger">*</span></CFormLabel>
        <CFormInput v-model="form.name" placeholder="Servidor de Producción Principal" />
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
        <CFormSelect :value="form.infrastructureId" @change="handleInfraChange">
          <option value="">— Sin especificar —</option>
          <option v-for="i in catalogs.infrastructures" :key="i.id" :value="String(i.id)">{{ i.name }} ({{ i.code }})</option>
        </CFormSelect>
      </CCol>
      <CCol :md="4">
        <CFormLabel class="fw-medium small">Proyecto</CFormLabel>
        <CFormSelect v-model="form.projectId" :disabled="!form.infrastructureId && projectsForInfra.length === 0">
          <option value="">— Sin proyecto —</option>
          <option v-for="p in projectsForInfra" :key="p.id" :value="String(p.id)">{{ p.name }}</option>
        </CFormSelect>
        <div v-if="!form.infrastructureId && catalogs.projects?.length > 0"
          class="text-medium-emphasis" style="font-size: 11px; margin-top: 2px">
          Seleccioná una infraestructura para filtrar proyectos
        </div>
      </CCol>
      <CCol :md="6">
        <CFormLabel class="fw-medium small">Producto / Plataforma</CFormLabel>
        <CFormSelect v-model="form.productId">
          <option value="">— Sin especificar —</option>
          <option v-for="p in catalogs.serverProducts" :key="p.id" :value="String(p.id)">{{ p.name }}</option>
        </CFormSelect>
      </CCol>
      <CCol :md="6">
        <CFormLabel class="fw-medium small">Sistema Operativo</CFormLabel>
        <CFormSelect v-model="form.osId">
          <option value="">— Sin especificar —</option>
          <option v-for="o in catalogs.osTypes" :key="o.id" :value="String(o.id)">{{ o.name }}</option>
        </CFormSelect>
      </CCol>
      <CCol :md="12">
        <CFormLabel class="fw-medium small">Descripción</CFormLabel>
        <CFormTextarea :rows="2" v-model="form.description" placeholder="Descripción opcional..." />
      </CCol>
    </CRow>
    <div class="d-flex gap-2 mt-4">
      <CButton color="secondary" variant="outline" @click="emit('cancel')" :disabled="loading">Cancelar</CButton>
      <CButton color="primary" class="ms-auto" @click="emit('save', form)" :disabled="loading || !isValid">
        <CSpinner v-if="loading" size="sm" class="me-2" />
        <template v-if="isEdit">{{ loading ? 'Guardando...' : 'Guardar cambios' }}</template>
        <template v-else>{{ loading ? 'Creando...' : 'Crear servidor' }}</template>
      </CButton>
    </div>
  </div>
</template>

<script>
import { reactive, computed, defineComponent } from 'vue'

export default defineComponent({
  name: 'ServerForm',
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
      hostname:         props.initial?.hostname          || '',
      name:             props.initial?.name             || '',
      ipAddress:        props.initial?.ip_address        || '',
      environmentId:    props.initial?.environment_id    ? String(props.initial.environment_id)    : '',
      infrastructureId: props.initial?.infrastructure_id ? String(props.initial.infrastructure_id) : '',
      projectId:        props.initial?.project_id        ? String(props.initial.project_id)        : '',
      productId:        props.initial?.product_id        ? String(props.initial.product_id)        : '',
      osId:             props.initial?.os_id             ? String(props.initial.os_id)             : '',
      description:      props.initial?.description       || '',
    })

    const projectsForInfra = computed(() =>
      (props.catalogs.projects || []).filter(
        p => !form.infrastructureId || String(p.infrastructure_id) === form.infrastructureId
      )
    )

    const isValid = computed(() => form.hostname.trim() && form.name.trim() && form.environmentId)

    function handleInfraChange(e) {
      const newInfraId = e.target.value
      const projStillValid = !newInfraId || (props.catalogs.projects || []).some(
        p => String(p.id) === form.projectId && String(p.infrastructure_id) === newInfraId
      )
      form.infrastructureId = newInfraId
      if (!projStillValid) form.projectId = ''
    }

    return { form, isEdit, projectsForInfra, isValid, handleInfraChange, emit }
  },
})
</script>
