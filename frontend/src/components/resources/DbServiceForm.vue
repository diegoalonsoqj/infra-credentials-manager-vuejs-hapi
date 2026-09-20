<!--
  DbServiceForm.vue — Formulario de alta y edición de servicio de base de datos.

  Extraído de DatabasesPage.vue, donde vivía como plantilla en string.
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
      <CCol :md="isEdit ? 8 : 12">
        <CFormLabel class="fw-medium small">Nombre descriptivo <span class="text-danger">*</span></CFormLabel>
        <CFormInput v-model="form.name" placeholder="PostgreSQL ERP Producción" />
      </CCol>

      <CCol :md="8">
        <CFormLabel class="fw-medium small">Host / Endpoint <span class="text-danger">*</span></CFormLabel>
        <CFormInput v-model="form.host" placeholder="10.0.0.5, mi-proyecto:us-central1:instancia, db.empresa.com"
          style="font-family: monospace" />
        <div class="text-medium-emphasis" style="font-size: 11px; margin-top: 3px">
          IP, FQDN o connection string del servicio.
        </div>
      </CCol>
      <CCol :md="4">
        <CFormLabel class="fw-medium small">Puerto</CFormLabel>
        <CFormInput type="number" :min="1" :max="65535" v-model="form.port" @input="handlePortInput"
          placeholder="Auto según motor" />
        <div class="text-medium-emphasis" style="font-size: 11px; margin-top: 2px">
          Se rellena al elegir el motor
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
        <div v-if="!form.infrastructureId && catalogs.projects && catalogs.projects.length > 0"
          class="text-medium-emphasis" style="font-size: 11px; margin-top: 2px">
          Seleccioná una infraestructura para filtrar proyectos
        </div>
      </CCol>

      <CCol :md="6">
        <CFormLabel class="fw-medium small">Producto / Servicio</CFormLabel>
        <CFormSelect v-model="form.productId">
          <option value="">— Sin especificar —</option>
          <option v-for="p in catalogs.dbProducts" :key="p.id" :value="String(p.id)">{{ p.name }}</option>
        </CFormSelect>
      </CCol>
      <CCol :md="6">
        <CFormLabel class="fw-medium small">Motor de BD</CFormLabel>
        <CFormSelect :value="form.engineId" @change="handleEngineChange">
          <option value="">— Sin especificar —</option>
          <option v-for="e in catalogs.dbEngines" :key="e.id" :value="String(e.id)">{{ e.name }}</option>
        </CFormSelect>
      </CCol>

      <CCol :md="12">
        <CFormLabel class="fw-medium small">Servidor host</CFormLabel>
        <CFormSelect v-model="form.serverId">
          <option value="">— Cloud managed / SaaS / sin servidor registrado —</option>
          <option v-for="s in catalogs.servers" :key="s.id" :value="String(s.id)">
            {{ s.code }} — {{ s.hostname }} ({{ s.environment_name }})
          </option>
        </CFormSelect>
        <div class="text-medium-emphasis" style="font-size: 11px; margin-top: 3px">
          Dejar vacío si el servicio es cloud-managed (Cloud SQL, RDS, Atlas).
        </div>
      </CCol>

      <CCol :md="12">
        <CFormLabel class="fw-medium small">Descripción</CFormLabel>
        <CFormTextarea :rows="2" v-model="form.description" placeholder="Descripción opcional..." />
      </CCol>
    </CRow>

    <div class="d-flex gap-2 mt-4">
      <CButton color="secondary" variant="outline" @click="emit('cancel')" :disabled="loading">Cancelar</CButton>
      <CButton color="primary" class="ms-auto" @click="emit('save', { ...form })" :disabled="loading || !isValid">
        <CSpinner v-if="loading" size="sm" class="me-2" />
        <template v-if="!loading">{{ isEdit ? 'Guardar cambios' : 'Crear servicio de BD' }}</template>
        <template v-else>{{ isEdit ? 'Guardando...' : 'Creando...' }}</template>
      </CButton>
    </div>
  </div>
</template>

<script>
import { ref, reactive, computed, defineComponent } from 'vue'

// Puerto habitual de cada motor, para rellenar el campo al elegirlo.
function getDefaultPort(engineName = '') {
  const n = engineName.toLowerCase()
  if (n.includes('postgres'))                                              return '5432'
  if (n.includes('mysql') || n.includes('mariadb'))                        return '3306'
  if (n.includes('oracle'))                                                return '1521'
  if (n.includes('sql server') || n.includes('mssql') || n.includes('sqlserver')) return '1433'
  if (n.includes('mongo'))                                                 return '27017'
  if (n.includes('redis'))                                                 return '6379'
  if (n.includes('elastic'))                                               return '9200'
  if (n.includes('cassandra'))                                             return '9042'
  if (n.includes('cockroach'))                                             return '26257'
  if (n.includes('db2'))                                                   return '50000'
  if (n.includes('clickhouse'))                                            return '9000'
  return ''
}

export default defineComponent({
  name: 'DbServiceForm',
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
      projectId:        props.initial?.project_id        ? String(props.initial.project_id)        : '',
      productId:        props.initial?.product_id        ? String(props.initial.product_id)        : '',
      engineId:         props.initial?.engine_id         ? String(props.initial.engine_id)         : '',
      serverId:         props.initial?.server_id         ? String(props.initial.server_id)         : '',
      description:      props.initial?.description       || '',
    })

    const projectsForInfra = computed(() =>
      (props.catalogs.projects || []).filter(
        p => !form.infrastructureId || String(p.infrastructure_id) === form.infrastructureId
      )
    )

    const isValid = computed(() => form.host.trim() && form.name.trim() && form.environmentId)

    function handleInfraChange(e) {
      const newInfraId = e.target.value
      const projStillValid = !newInfraId || (props.catalogs.projects || []).some(
        p => String(p.id) === form.projectId && String(p.infrastructure_id) === newInfraId
      )
      form.infrastructureId = newInfraId
      if (!projStillValid) form.projectId = ''
    }

    function defaultPortOf(engineId) {
      const engine = (props.catalogs.dbEngines || []).find(eng => String(eng.id) === engineId)
      return engine ? getDefaultPort(engine.name) : ''
    }

    // El puerto sigue al motor salvo que el usuario lo haya escrito a mano,
    // aunque coincida con el de por defecto. Un puerto ya guardado cuenta como
    // escrito a mano si no es el de por defecto de su motor.
    const portManual = ref(!!form.port && form.port !== defaultPortOf(form.engineId))

    // CFormInput emite 'input' antes de actualizar el v-model: form.port aún
    // tiene el valor anterior, así que se lee del evento.
    function handlePortInput(e) {
      portManual.value = e.target.value !== ''
    }

    function handleEngineChange(e) {
      form.engineId = e.target.value
      if (!portManual.value) form.port = defaultPortOf(form.engineId)
    }

    return { form, isEdit, projectsForInfra, isValid, handleInfraChange, handleEngineChange, handlePortInput, emit }
  },
})
</script>
