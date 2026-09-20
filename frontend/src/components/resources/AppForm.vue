<!--
  AppForm.vue — Formulario de alta y edición de aplicación.

  Extraído de ApplicationsPage.vue, donde vivía como plantilla en string.
  Eso exigía el compilador de Vue en el navegador (new Function()), que la CSP
  del backend bloquea (script-src 'self', sin unsafe-eval) y dejaba la página en
  blanco en producción. Como SFC, Vite lo compila en el build.
-->
<template>
  <CRow class="g-3">
    <CCol v-if="!isCreate && form._code" :md="6">
      <CFormLabel class="small fw-semibold text-medium-emphasis">Código (sistema)</CFormLabel>
      <CFormInput size="sm" :value="form._code" disabled style="background: var(--cui-tertiary-bg); font-family: monospace" />
    </CCol>
    <CCol :md="isCreate ? 12 : 6">
      <CFormLabel class="small fw-semibold">Tipo de app *</CFormLabel>
      <CFormSelect size="sm" :value="form.appType" @change="set('appType', $event.target.value)">
        <option v-for="t in APP_TYPES_LOCAL" :key="t.value" :value="t.value">{{ t.label }}</option>
      </CFormSelect>
    </CCol>
    <CCol :md="12">
      <CFormLabel class="small fw-semibold">Nombre *</CFormLabel>
      <CFormInput size="sm" :value="form.name" placeholder="ej: ERP Corporativo"
        @input="set('name', $event.target.value)" required />
    </CCol>
    <CCol :md="6">
      <CFormLabel class="small fw-semibold">Ambiente *</CFormLabel>
      <CFormSelect size="sm" :value="form.environmentId" @change="set('environmentId', $event.target.value)" required>
        <option value="">— Seleccionar —</option>
        <option v-for="e in environments" :key="e.id" :value="String(e.id)">{{ e.code }} — {{ e.name }}</option>
      </CFormSelect>
    </CCol>
    <CCol :md="6">
      <CFormLabel class="small fw-semibold">Servidor (opcional)</CFormLabel>
      <CFormSelect size="sm" :value="form.serverId" @change="set('serverId', $event.target.value)">
        <option value="">— Externo / SaaS —</option>
        <option v-for="s in servers" :key="s.id" :value="String(s.id)">{{ s.code }} — {{ s.name }}</option>
      </CFormSelect>
      <div class="text-medium-emphasis" style="font-size: 11px; margin-top: 2px">
        Dejar vacío si la app es externa o SaaS.
      </div>
    </CCol>
    <CCol :md="12">
      <CFormLabel class="small fw-semibold">URL (opcional)</CFormLabel>
      <CFormInput size="sm" type="url" :value="form.url" placeholder="https://app.empresa.com"
        @input="set('url', $event.target.value)" />
    </CCol>
    <CCol :md="12">
      <CFormLabel class="small fw-semibold">Descripción</CFormLabel>
      <CFormTextarea size="sm" :rows="2" :value="form.description"
        @input="set('description', $event.target.value)" />
    </CCol>
  </CRow>
</template>

<script>
import { defineComponent } from 'vue'

export default defineComponent({
  name: 'AppForm',
  props: {
    form:         { type: Object,  required: true },
    environments: { type: Array,   default: () => [] },
    servers:      { type: Array,   default: () => [] },
    isCreate:     { type: Boolean, default: false },
  },
  emits: ['update:form'],
  setup(props, { emit }) {
    const APP_TYPES_LOCAL = [
      { value: 'WEB',     label: 'WEB — Aplicación web' },
      { value: 'API',     label: 'API — Servicio REST/SOAP' },
      { value: 'SERVICE', label: 'SERVICE — Servicio de sistema' },
      { value: 'OTHER',   label: 'OTHER — Otro' },
    ]
    const set = (field, val) => emit('update:form', { ...props.form, [field]: val })
    return { APP_TYPES_LOCAL, set }
  },
})
</script>
