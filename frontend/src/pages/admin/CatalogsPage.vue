<template>
  <div class="bg-body-tertiary py-4" style="height: 100%; overflow-y: auto">
    <CContainer>

      <div v-if="loading" class="d-flex justify-content-center py-5"><CSpinner /></div>
      <CAlert v-else-if="error" color="danger">{{ error }}</CAlert>

      <CCard v-else class="shadow-sm">
        <CCardBody class="pt-3 pb-0 px-3">
          <div class="d-flex align-items-center justify-content-between mb-3">
            <div class="d-flex align-items-center gap-2">
              <span class="text-medium-emphasis" style="font-size: 13px">Catálogo:</span>
              <CFormSelect style="width: 230px; font-size: 13px" v-model="tab" @change="catPage = 1">
                <option value="environments">Ambientes</option>
                <option value="infrastructures">Infraestructura</option>
                <option value="roles">Roles</option>
                <option value="teams">Equipos</option>
                <option value="cat-os">Sis. Operativos</option>
                <option value="cat-server-products">Prod. Servidor</option>
                <option value="cat-db-products">Prod. BD</option>
                <option value="cat-db-engines">Motores BD</option>
                <option value="cat-network-products">Prod. Red</option>
                <option value="projects">Proyectos</option>
                <option value="resource-types">Tipos Recurso</option>
              </CFormSelect>
            </div>
            <div>
              <CButton v-if="tab === 'environments'" color="primary" size="sm"
                @click="Object.assign(envForm, EMPTY_ENV); formError = null; showEnvCreate = true">+ Nuevo ambiente</CButton>
              <CButton v-if="tab === 'infrastructures'" color="primary" size="sm"
                @click="Object.assign(infraForm, EMPTY_INFRA); formError = null; showInfraCreate = true">+ Nueva infraestructura</CButton>
              <CButton v-if="tab === 'roles'" color="primary" size="sm"
                @click="Object.assign(roleForm, EMPTY_ROLE); formError = null; showRoleCreate = true">+ Nuevo rol</CButton>
              <CButton v-if="tab === 'teams'" color="primary" size="sm"
                @click="Object.assign(teamForm, {...EMPTY_TEAM}); formError = null; showTeamCreate = true">+ Nuevo equipo</CButton>
              <CButton v-if="tab === 'cat-os'" color="primary" size="sm" @click="catOsRef?.openCreate()">+ Nuevo SO</CButton>
              <CButton v-if="tab === 'cat-server-products'" color="primary" size="sm" @click="catServerRef?.openCreate()">+ Nuevo Producto servidor</CButton>
              <CButton v-if="tab === 'cat-db-products'" color="primary" size="sm" @click="catDbProductRef?.openCreate()">+ Nuevo Producto BD</CButton>
              <CButton v-if="tab === 'cat-db-engines'" color="primary" size="sm" @click="catDbEngineRef?.openCreate()">+ Nuevo Motor BD</CButton>
              <CButton v-if="tab === 'cat-network-products'" color="primary" size="sm" @click="catNetworkProductRef?.openCreate()">+ Nuevo Producto de red</CButton>
              <CButton v-if="tab === 'projects'" color="primary" size="sm"
                @click="Object.assign(projForm, EMPTY_PROJ); formError = null; showProjCreate = true">+ Nuevo proyecto</CButton>
            </div>
          </div>
        </CCardBody>

        <!-- TAB: Ambientes -->
        <template v-if="tab === 'environments'">
          <CTable small hover responsive class="mb-0" style="font-size: 13px">
            <CTableHead>
              <CTableRow>
                <CTableHeaderCell>Código</CTableHeaderCell>
                <CTableHeaderCell>Nombre</CTableHeaderCell>
                <CTableHeaderCell>Orden</CTableHeaderCell>
                <CTableHeaderCell>PRD</CTableHeaderCell>
                <CTableHeaderCell>Estado</CTableHeaderCell>
                <CTableHeaderCell>Acciones</CTableHeaderCell>
              </CTableRow>
            </CTableHead>
            <CTableBody>
              <CTableRow v-if="environments.length === 0">
                <CTableDataCell :colspan="6" class="text-center text-medium-emphasis py-4">Sin ambientes registrados.</CTableDataCell>
              </CTableRow>
              <CTableRow v-for="env in catPageOf(environments)" :key="env.id">
                <CTableDataCell class="fw-semibold">{{ env.code }}</CTableDataCell>
                <CTableDataCell>{{ env.name }}</CTableDataCell>
                <CTableDataCell class="text-medium-emphasis">{{ env.sort_order }}</CTableDataCell>
                <CTableDataCell>
                  <CBadge v-if="env.prd_flag" color="danger">PRD</CBadge>
                  <span v-else class="text-medium-emphasis">—</span>
                </CTableDataCell>
                <CTableDataCell>
                  <CBadge :color="env.estado === 'AI' ? 'success' : 'secondary'">{{ env.estado === 'AI' ? 'Activo' : 'Inactivo' }}</CBadge>
                </CTableDataCell>
                <CTableDataCell>
                  <div class="d-flex gap-1">
                    <CButton color="info" size="sm" variant="outline" title="Editar" @click="openEnvEdit(env)"><Pencil :size="13" /></CButton>
                    <CButton :color="env.estado === 'AI' ? 'secondary' : 'success'" size="sm" variant="outline"
                      :title="env.estado === 'AI' ? 'Desactivar' : 'Activar'" @click="handleEnvToggle(env)">
                      <Ban v-if="env.estado === 'AI'" :size="13" /><CheckCircle2 v-else :size="13" />
                    </CButton>
                    <CButton color="danger" size="sm" variant="outline" title="Eliminar" @click="openEnvDelete(env)"><Trash2 :size="13" /></CButton>
                  </div>
                </CTableDataCell>
              </CTableRow>
            </CTableBody>
          </CTable>
        </template>

        <!-- TAB: Infraestructuras -->
        <template v-else-if="tab === 'infrastructures'">
          <CTable small hover responsive class="mb-0" style="font-size: 13px">
            <CTableHead>
              <CTableRow>
                <CTableHeaderCell>Código</CTableHeaderCell>
                <CTableHeaderCell>Nombre</CTableHeaderCell>
                <CTableHeaderCell>Descripción</CTableHeaderCell>
                <CTableHeaderCell>Estado</CTableHeaderCell>
                <CTableHeaderCell>Acciones</CTableHeaderCell>
              </CTableRow>
            </CTableHead>
            <CTableBody>
              <CTableRow v-if="infrastructures.length === 0">
                <CTableDataCell :colspan="5" class="text-center text-medium-emphasis py-4">Sin infraestructuras registradas.</CTableDataCell>
              </CTableRow>
              <CTableRow v-for="infra in catPageOf(infrastructures)" :key="infra.id">
                <CTableDataCell class="fw-semibold">{{ infra.code }}</CTableDataCell>
                <CTableDataCell>{{ infra.name }}</CTableDataCell>
                <CTableDataCell class="text-medium-emphasis" style="font-size: 11px">{{ infra.description || '—' }}</CTableDataCell>
                <CTableDataCell>
                  <CBadge :color="infra.estado === 'AI' ? 'success' : 'secondary'">{{ infra.estado === 'AI' ? 'Activo' : 'Inactivo' }}</CBadge>
                </CTableDataCell>
                <CTableDataCell>
                  <div class="d-flex gap-1">
                    <CButton color="info" size="sm" variant="outline" title="Editar" @click="openInfraEdit(infra)"><Pencil :size="13" /></CButton>
                    <CButton :color="infra.estado === 'AI' ? 'secondary' : 'success'" size="sm" variant="outline"
                      :title="infra.estado === 'AI' ? 'Desactivar' : 'Activar'" @click="handleInfraToggle(infra)">
                      <Ban v-if="infra.estado === 'AI'" :size="13" /><CheckCircle2 v-else :size="13" />
                    </CButton>
                    <CButton color="danger" size="sm" variant="outline" title="Eliminar" @click="openInfraDelete(infra)"><Trash2 :size="13" /></CButton>
                  </div>
                </CTableDataCell>
              </CTableRow>
            </CTableBody>
          </CTable>
        </template>

        <!-- TAB: Roles -->
        <template v-else-if="tab === 'roles'">
          <p class="text-medium-emphasis small px-3 pt-2 mb-1">Nivel máximo creable: 99 (100 es exclusivo del sistema ADMIN)</p>
          <CTable small hover responsive class="mb-0" style="font-size: 13px">
            <CTableHead>
              <CTableRow>
                <CTableHeaderCell>Código</CTableHeaderCell>
                <CTableHeaderCell>Nombre</CTableHeaderCell>
                <CTableHeaderCell>Nivel</CTableHeaderCell>
                <CTableHeaderCell>Sistema</CTableHeaderCell>
                <CTableHeaderCell>Estado</CTableHeaderCell>
                <CTableHeaderCell>Acciones</CTableHeaderCell>
              </CTableRow>
            </CTableHead>
            <CTableBody>
              <CTableRow v-for="r in catPageOf(roles)" :key="r.id">
                <CTableDataCell class="fw-semibold">{{ r.code }}</CTableDataCell>
                <CTableDataCell>{{ r.name }}</CTableDataCell>
                <CTableDataCell><CBadge :color="levelColor(r.level)">{{ r.level }}</CBadge></CTableDataCell>
                <CTableDataCell>
                  <CBadge v-if="r.is_system" color="dark" title="Rol del sistema — protegido">Sistema</CBadge>
                  <span v-else class="text-medium-emphasis">—</span>
                </CTableDataCell>
                <CTableDataCell>
                  <CBadge :color="r.estado === 'AI' ? 'success' : 'secondary'">{{ r.estado === 'AI' ? 'Activo' : 'Inactivo' }}</CBadge>
                </CTableDataCell>
                <CTableDataCell>
                  <div class="d-flex gap-1">
                    <CButton color="info" size="sm" variant="outline" title="Editar" @click="openRoleEdit(r)"><Pencil :size="13" /></CButton>
                    <CButton color="primary" size="sm" variant="outline" title="Permisos" @click="openRolePerms(r)"><Shield :size="13" /></CButton>
                    <template v-if="!r.is_system">
                      <CButton :color="r.estado === 'AI' ? 'secondary' : 'success'" size="sm" variant="outline"
                        :title="r.estado === 'AI' ? 'Desactivar' : 'Activar'" @click="handleRoleToggle(r)">
                        <Ban v-if="r.estado === 'AI'" :size="13" /><CheckCircle2 v-else :size="13" />
                      </CButton>
                      <CButton color="danger" size="sm" variant="outline" title="Eliminar" @click="openRoleDelete(r)"><Trash2 :size="13" /></CButton>
                    </template>
                  </div>
                </CTableDataCell>
              </CTableRow>
            </CTableBody>
          </CTable>
        </template>

        <!-- TAB: Equipos -->
        <template v-else-if="tab === 'teams'">
          <CTable small hover responsive class="mb-0" style="font-size: 13px">
            <CTableHead>
              <CTableRow>
                <CTableHeaderCell>Código</CTableHeaderCell>
                <CTableHeaderCell>Nombre</CTableHeaderCell>
                <CTableHeaderCell>Tipo recurso</CTableHeaderCell>
                <CTableHeaderCell>Sistema</CTableHeaderCell>
                <CTableHeaderCell>Estado</CTableHeaderCell>
                <CTableHeaderCell>Acciones</CTableHeaderCell>
              </CTableRow>
            </CTableHead>
            <CTableBody>
              <CTableRow v-for="t in catPageOf(teams)" :key="t.id">
                <CTableDataCell class="fw-semibold">{{ t.code }}</CTableDataCell>
                <CTableDataCell>{{ t.name }}</CTableDataCell>
                <CTableDataCell>
                  <div class="d-flex gap-1 flex-wrap">
                    <CBadge v-for="rt in (t.resource_types || [])" :key="rt"
                      :color="TEAM_RT_COLORS[rt] || 'secondary'">{{ rt }}</CBadge>
                  </div>
                </CTableDataCell>
                <CTableDataCell>
                  <CBadge v-if="t.is_system" color="dark" title="Equipo del sistema — protegido">Sistema</CBadge>
                  <span v-else class="text-medium-emphasis">—</span>
                </CTableDataCell>
                <CTableDataCell>
                  <CBadge :color="t.estado === 'AI' ? 'success' : 'secondary'">{{ t.estado === 'AI' ? 'Activo' : 'Inactivo' }}</CBadge>
                </CTableDataCell>
                <CTableDataCell>
                  <div class="d-flex gap-1">
                    <CButton color="info" size="sm" variant="outline" title="Editar" @click="openTeamEdit(t)"><Pencil :size="13" /></CButton>
                    <template v-if="!t.is_system">
                      <CButton :color="t.estado === 'AI' ? 'secondary' : 'success'" size="sm" variant="outline"
                        :title="t.estado === 'AI' ? 'Desactivar' : 'Activar'" @click="handleTeamToggle(t)">
                        <Ban v-if="t.estado === 'AI'" :size="13" /><CheckCircle2 v-else :size="13" />
                      </CButton>
                      <CButton color="danger" size="sm" variant="outline" title="Eliminar" @click="openTeamDelete(t)"><Trash2 :size="13" /></CButton>
                    </template>
                  </div>
                </CTableDataCell>
              </CTableRow>
            </CTableBody>
          </CTable>
        </template>

        <!-- TABs: Catálogos simples (SO, productos, motores) -->
        <template v-else-if="tab === 'cat-os'">
          <SimpleCatalogTab ref="catOsRef" api-prefix="/catalogs/cat-os" singular-label="SO / Sistema operativo" />
        </template>
        <template v-else-if="tab === 'cat-server-products'">
          <SimpleCatalogTab ref="catServerRef" api-prefix="/catalogs/cat-server-products" singular-label="Producto servidor" />
        </template>
        <template v-else-if="tab === 'cat-db-products'">
          <SimpleCatalogTab ref="catDbProductRef" api-prefix="/catalogs/cat-db-products" singular-label="Producto BD" />
        </template>
        <template v-else-if="tab === 'cat-db-engines'">
          <SimpleCatalogTab ref="catDbEngineRef" api-prefix="/catalogs/cat-db-engines" singular-label="Motor BD" />
        </template>
        <template v-else-if="tab === 'cat-network-products'">
          <SimpleCatalogTab ref="catNetworkProductRef" api-prefix="/catalogs/cat-network-products" singular-label="Producto de red" />
        </template>

        <!-- TAB: Proyectos -->
        <template v-else-if="tab === 'projects'">
          <CTable small hover responsive class="mb-0" style="font-size: 13px">
            <CTableHead>
              <CTableRow>
                <CTableHeaderCell>Código</CTableHeaderCell>
                <CTableHeaderCell>Nombre</CTableHeaderCell>
                <CTableHeaderCell>Infraestructura</CTableHeaderCell>
                <CTableHeaderCell>Orden</CTableHeaderCell>
                <CTableHeaderCell>Estado</CTableHeaderCell>
                <CTableHeaderCell>Acciones</CTableHeaderCell>
              </CTableRow>
            </CTableHead>
            <CTableBody>
              <CTableRow v-if="projects.length === 0">
                <CTableDataCell :colspan="6" class="text-center text-medium-emphasis py-4">Sin proyectos registrados. Agrega el primero con el botón +.</CTableDataCell>
              </CTableRow>
              <CTableRow v-for="proj in catPageOf(projects)" :key="proj.id">
                <CTableDataCell class="fw-semibold">{{ proj.code }}</CTableDataCell>
                <CTableDataCell>{{ proj.name }}</CTableDataCell>
                <CTableDataCell class="text-medium-emphasis">
                  <CBadge v-if="proj.infrastructure_name" color="info" style="font-size: 11px">{{ proj.infrastructure_code }} — {{ proj.infrastructure_name }}</CBadge>
                  <span v-else class="text-medium-emphasis">—</span>
                </CTableDataCell>
                <CTableDataCell class="text-medium-emphasis">{{ proj.sort_order ?? 0 }}</CTableDataCell>
                <CTableDataCell>
                  <CBadge :color="proj.estado === 'AI' ? 'success' : 'secondary'">{{ proj.estado === 'AI' ? 'Activo' : 'Inactivo' }}</CBadge>
                </CTableDataCell>
                <CTableDataCell>
                  <div class="d-flex gap-1">
                    <CButton color="info" size="sm" variant="outline" title="Editar" @click="openProjEdit(proj)"><Pencil :size="13" /></CButton>
                    <CButton :color="proj.estado === 'AI' ? 'secondary' : 'success'" size="sm" variant="outline"
                      :title="proj.estado === 'AI' ? 'Desactivar' : 'Activar'" @click="handleProjToggle(proj)">
                      <Ban v-if="proj.estado === 'AI'" :size="13" /><CheckCircle2 v-else :size="13" />
                    </CButton>
                    <CButton color="danger" size="sm" variant="outline" title="Eliminar" @click="openProjDelete(proj)"><Trash2 :size="13" /></CButton>
                  </div>
                </CTableDataCell>
              </CTableRow>
            </CTableBody>
          </CTable>
        </template>

        <!-- TAB: Tipos de recurso (informativo) -->
        <template v-else-if="tab === 'resource-types'">
          <div class="px-3 py-2 border-top">
            <span class="fw-semibold small">Tipos de recurso — clasificación fija del sistema</span>
          </div>
          <div class="p-3">
            <CAlert color="info" class="py-2 small mb-3">
              Los tipos de recurso son valores fijos definidos en el sistema. No pueden crearse ni eliminarse.
              Cada equipo (<strong>Team</strong>) tiene asignado un tipo de recurso que determina qué clase de credenciales puede gestionar.
            </CAlert>
            <CRow class="g-3">
              <CCol v-for="rt in RESOURCE_TYPES" :key="rt.code" :md="6" :xl="3">
                <CCard class="h-100 shadow-sm">
                  <CCardHeader class="py-2 d-flex align-items-center gap-2">
                    <CBadge :color="rt.color" style="font-size: 13px; padding: 4px 10px">{{ rt.code }}</CBadge>
                    <span class="fw-semibold">{{ rt.label }}</span>
                  </CCardHeader>
                  <CCardBody class="py-3">
                    <p class="small text-medium-emphasis mb-3">{{ rt.description }}</p>
                    <div class="d-flex flex-column gap-1" style="font-size: 12px">
                      <div class="d-flex justify-content-between">
                        <span class="text-medium-emphasis">Tipo de credencial:</span>
                        <span class="fw-semibold">{{ rt.credential }}</span>
                      </div>
                      <div class="d-flex justify-content-between">
                        <span class="text-medium-emphasis">Equipos totales:</span>
                        <CBadge color="secondary">{{ teams.filter(t => (t.resource_types || []).includes(rt.code)).length }}</CBadge>
                      </div>
                      <div class="d-flex justify-content-between">
                        <span class="text-medium-emphasis">Equipos activos:</span>
                        <CBadge color="success">{{ teams.filter(t => (t.resource_types || []).includes(rt.code) && t.estado === 'AI').length }}</CBadge>
                      </div>
                    </div>
                  </CCardBody>
                </CCard>
              </CCol>
            </CRow>
          </div>
        </template>

      </CCard>

    </CContainer>

    <!-- MODALS: Ambiente -->
    <CModal :visible="showEnvCreate" @close="showEnvCreate = false">
      <CModalHeader><CModalTitle>Nuevo ambiente</CModalTitle></CModalHeader>
      <form @submit.prevent="handleEnvCreate">
        <CModalBody>
          <CAlert v-if="formError" color="danger" class="py-2 small">{{ formError }}</CAlert>
          <CRow class="g-3">
            <CCol :md="6"><CFormLabel class="small fw-semibold">Código *</CFormLabel>
              <CFormInput size="sm" placeholder="ej: STG" v-model="envForm.code" required /></CCol>
            <CCol :md="6"><CFormLabel class="small fw-semibold">Orden</CFormLabel>
              <CFormInput size="sm" type="number" :min="0" v-model.number="envForm.sortOrder" /></CCol>
            <CCol :md="12"><CFormLabel class="small fw-semibold">Nombre *</CFormLabel>
              <CFormInput size="sm" placeholder="ej: Staging" v-model="envForm.name" required /></CCol>
            <CCol :md="12"><CFormLabel class="small fw-semibold">Descripción</CFormLabel>
              <CFormTextarea size="sm" :rows="2" v-model="envForm.description" /></CCol>
            <CCol :md="12">
              <CFormCheck id="envPrd" label="Marcar como ambiente productivo (PRD flag)" v-model="envForm.prdFlag" />
              <div v-if="envForm.prdFlag" class="text-danger small mt-1">⚠ Los accesos a ambientes PRD generan auditoría reforzada.</div>
            </CCol>
          </CRow>
        </CModalBody>
        <CModalFooter>
          <CButton color="secondary" variant="outline" @click="showEnvCreate = false" :disabled="saving">Cancelar</CButton>
          <CButton color="primary" type="submit" :disabled="saving"><CSpinner v-if="saving" size="sm" /><template v-else>Crear</template></CButton>
        </CModalFooter>
      </form>
    </CModal>

    <CModal :visible="showEnvEdit" @close="showEnvEdit = false">
      <CModalHeader><CModalTitle>Editar ambiente — {{ selected?.code }}</CModalTitle></CModalHeader>
      <form @submit.prevent="handleEnvEdit">
        <CModalBody>
          <CAlert v-if="formError" color="danger" class="py-2 small">{{ formError }}</CAlert>
          <CRow class="g-3">
            <CCol :md="6"><CFormLabel class="small fw-semibold text-medium-emphasis">Código (no editable)</CFormLabel>
              <CFormInput size="sm" :value="envForm.code" disabled /></CCol>
            <CCol :md="6"><CFormLabel class="small fw-semibold">Orden</CFormLabel>
              <CFormInput size="sm" type="number" :min="0" v-model.number="envForm.sortOrder" /></CCol>
            <CCol :md="12"><CFormLabel class="small fw-semibold">Nombre *</CFormLabel>
              <CFormInput size="sm" v-model="envForm.name" required /></CCol>
            <CCol :md="12"><CFormLabel class="small fw-semibold">Descripción</CFormLabel>
              <CFormTextarea size="sm" :rows="2" v-model="envForm.description" /></CCol>
            <CCol :md="12"><CFormCheck id="envPrdEdit" label="Ambiente productivo (PRD flag)" v-model="envForm.prdFlag" /></CCol>
          </CRow>
        </CModalBody>
        <CModalFooter>
          <CButton color="secondary" variant="outline" @click="showEnvEdit = false" :disabled="saving">Cancelar</CButton>
          <CButton color="primary" type="submit" :disabled="saving"><CSpinner v-if="saving" size="sm" /><template v-else>Guardar</template></CButton>
        </CModalFooter>
      </form>
    </CModal>

    <CModal :visible="showEnvDelete" @close="showEnvDelete = false">
      <CModalHeader><CModalTitle>Eliminar ambiente</CModalTitle></CModalHeader>
      <CModalBody>
        <CAlert v-if="formError" color="danger" class="py-2 small">{{ formError }}</CAlert>
        <p class="mb-1">¿Eliminar el ambiente <strong>{{ selected?.code }} — {{ selected?.name }}</strong>?</p>
        <UsageWarning :usages="deleteUsages" />
        <p v-if="!deleteUsages?.length" class="text-medium-emphasis small mb-0">No es posible si existen instancias asociadas.</p>
      </CModalBody>
      <CModalFooter>
        <CButton color="secondary" variant="outline" @click="showEnvDelete = false" :disabled="saving">Cancelar</CButton>
        <CButton color="danger" @click="handleEnvDelete" :disabled="saving || usagesLoading || deleteUsages?.length > 0"><CSpinner v-if="saving" size="sm" /><template v-else>Eliminar</template></CButton>
      </CModalFooter>
    </CModal>

    <!-- MODALS: Infraestructura -->
    <CModal :visible="showInfraCreate" @close="showInfraCreate = false">
      <CModalHeader><CModalTitle>Nueva infraestructura</CModalTitle></CModalHeader>
      <form @submit.prevent="handleInfraCreate">
        <CModalBody>
          <CAlert v-if="formError" color="danger" class="py-2 small">{{ formError }}</CAlert>
          <CRow class="g-3">
            <CCol :md="6"><CFormLabel class="small fw-semibold">Código *</CFormLabel>
              <CFormInput size="sm" placeholder="ej: AZURE" v-model="infraForm.code" required /></CCol>
            <CCol :md="12"><CFormLabel class="small fw-semibold">Nombre *</CFormLabel>
              <CFormInput size="sm" placeholder="ej: Microsoft Azure" v-model="infraForm.name" required /></CCol>
            <CCol :md="12"><CFormLabel class="small fw-semibold">Descripción</CFormLabel>
              <CFormTextarea size="sm" :rows="2" v-model="infraForm.description" /></CCol>
          </CRow>
        </CModalBody>
        <CModalFooter>
          <CButton color="secondary" variant="outline" @click="showInfraCreate = false" :disabled="saving">Cancelar</CButton>
          <CButton color="primary" type="submit" :disabled="saving"><CSpinner v-if="saving" size="sm" /><template v-else>Crear</template></CButton>
        </CModalFooter>
      </form>
    </CModal>

    <CModal :visible="showInfraEdit" @close="showInfraEdit = false">
      <CModalHeader><CModalTitle>Editar infraestructura — {{ selected?.code }}</CModalTitle></CModalHeader>
      <form @submit.prevent="handleInfraEdit">
        <CModalBody>
          <CAlert v-if="formError" color="danger" class="py-2 small">{{ formError }}</CAlert>
          <CRow class="g-3">
            <CCol :md="6"><CFormLabel class="small fw-semibold text-medium-emphasis">Código (no editable)</CFormLabel>
              <CFormInput size="sm" :value="infraForm.code" disabled /></CCol>
            <CCol :md="12"><CFormLabel class="small fw-semibold">Nombre *</CFormLabel>
              <CFormInput size="sm" v-model="infraForm.name" required /></CCol>
            <CCol :md="12"><CFormLabel class="small fw-semibold">Descripción</CFormLabel>
              <CFormTextarea size="sm" :rows="2" v-model="infraForm.description" /></CCol>
          </CRow>
        </CModalBody>
        <CModalFooter>
          <CButton color="secondary" variant="outline" @click="showInfraEdit = false" :disabled="saving">Cancelar</CButton>
          <CButton color="primary" type="submit" :disabled="saving"><CSpinner v-if="saving" size="sm" /><template v-else>Guardar</template></CButton>
        </CModalFooter>
      </form>
    </CModal>

    <CModal :visible="showInfraDelete" @close="showInfraDelete = false">
      <CModalHeader><CModalTitle>Eliminar infraestructura</CModalTitle></CModalHeader>
      <CModalBody>
        <CAlert v-if="formError" color="danger" class="py-2 small">{{ formError }}</CAlert>
        <p class="mb-1">¿Eliminar la infraestructura <strong>{{ selected?.code }} — {{ selected?.name }}</strong>?</p>
        <UsageWarning :usages="deleteUsages" />
        <p v-if="!deleteUsages?.length" class="text-medium-emphasis small mb-0">No es posible si existen instancias asociadas.</p>
      </CModalBody>
      <CModalFooter>
        <CButton color="secondary" variant="outline" @click="showInfraDelete = false" :disabled="saving">Cancelar</CButton>
        <CButton color="danger" @click="handleInfraDelete" :disabled="saving || usagesLoading || deleteUsages?.length > 0"><CSpinner v-if="saving" size="sm" /><template v-else>Eliminar</template></CButton>
      </CModalFooter>
    </CModal>

    <!-- MODALS: Rol -->
    <CModal :visible="showRoleCreate" @close="showRoleCreate = false">
      <CModalHeader><CModalTitle>Nuevo rol</CModalTitle></CModalHeader>
      <form @submit.prevent="handleRoleCreate">
        <CModalBody>
          <CAlert v-if="formError" color="danger" class="py-2 small">{{ formError }}</CAlert>
          <CRow class="g-3">
            <CCol :md="6"><CFormLabel class="small fw-semibold">Código *</CFormLabel>
              <CFormInput size="sm" placeholder="ej: SENIOR_OPS" v-model="roleForm.code" required /></CCol>
            <CCol :md="6">
              <CFormLabel class="small fw-semibold">Nivel (0–99) *</CFormLabel>
              <CFormInput size="sm" type="number" :min="0" :max="99" v-model.number="roleForm.level" required />
              <div class="text-medium-emphasis" style="font-size: 11px; margin-top: 2px">VIEWER=20 · OPERATOR=50 · LEADER=70 · ADMIN=100 (reservado)</div>
            </CCol>
            <CCol :md="12"><CFormLabel class="small fw-semibold">Nombre *</CFormLabel>
              <CFormInput size="sm" placeholder="ej: Operador Senior" v-model="roleForm.name" required /></CCol>
            <CCol :md="12"><CFormLabel class="small fw-semibold">Descripción</CFormLabel>
              <CFormTextarea size="sm" :rows="2" v-model="roleForm.description" /></CCol>
          </CRow>
        </CModalBody>
        <CModalFooter>
          <CButton color="secondary" variant="outline" @click="showRoleCreate = false" :disabled="saving">Cancelar</CButton>
          <CButton color="primary" type="submit" :disabled="saving"><CSpinner v-if="saving" size="sm" /><template v-else>Crear</template></CButton>
        </CModalFooter>
      </form>
    </CModal>

    <CModal :visible="showRoleEdit" @close="showRoleEdit = false">
      <CModalHeader><CModalTitle>Editar rol — {{ selected?.code }}</CModalTitle></CModalHeader>
      <form @submit.prevent="handleRoleEdit">
        <CModalBody>
          <CAlert v-if="formError" color="danger" class="py-2 small">{{ formError }}</CAlert>
          <CRow class="g-3">
            <CCol :md="6"><CFormLabel class="small fw-semibold text-medium-emphasis">Código (no editable)</CFormLabel>
              <CFormInput size="sm" :value="roleForm.code" disabled /></CCol>
            <CCol :md="6"><CFormLabel class="small fw-semibold text-medium-emphasis">Nivel (no editable)</CFormLabel>
              <CFormInput size="sm" :value="roleForm.level" disabled /></CCol>
            <CCol :md="12"><CFormLabel class="small fw-semibold">Nombre *</CFormLabel>
              <CFormInput size="sm" v-model="roleForm.name" required /></CCol>
            <CCol :md="12"><CFormLabel class="small fw-semibold">Descripción</CFormLabel>
              <CFormTextarea size="sm" :rows="2" v-model="roleForm.description" /></CCol>
          </CRow>
        </CModalBody>
        <CModalFooter>
          <CButton color="secondary" variant="outline" @click="showRoleEdit = false" :disabled="saving">Cancelar</CButton>
          <CButton color="primary" type="submit" :disabled="saving"><CSpinner v-if="saving" size="sm" /><template v-else>Guardar</template></CButton>
        </CModalFooter>
      </form>
    </CModal>

    <CModal :visible="showRoleDelete" @close="showRoleDelete = false">
      <CModalHeader><CModalTitle>Eliminar rol</CModalTitle></CModalHeader>
      <CModalBody>
        <CAlert v-if="formError" color="danger" class="py-2 small">{{ formError }}</CAlert>
        <p class="mb-1">¿Eliminar el rol <strong>{{ selected?.code }} — {{ selected?.name }}</strong>?</p>
        <p class="text-medium-emphasis small mb-0">No es posible si hay usuarios con este rol asignado.</p>
      </CModalBody>
      <CModalFooter>
        <CButton color="secondary" variant="outline" @click="showRoleDelete = false" :disabled="saving">Cancelar</CButton>
        <CButton color="danger" @click="handleRoleDelete" :disabled="saving"><CSpinner v-if="saving" size="sm" /><template v-else>Eliminar</template></CButton>
      </CModalFooter>
    </CModal>

    <!-- MODALS: Equipo -->
    <CModal :visible="showTeamCreate" @close="showTeamCreate = false">
      <CModalHeader><CModalTitle>Nuevo equipo</CModalTitle></CModalHeader>
      <form @submit.prevent="handleTeamCreate">
        <CModalBody>
          <CAlert v-if="formError" color="danger" class="py-2 small">{{ formError }}</CAlert>
          <CRow class="g-3">
            <CCol :md="6"><CFormLabel class="small fw-semibold">Código *</CFormLabel>
              <CFormInput size="sm" placeholder="ej: DBA_CLOUD" v-model="teamForm.code" required /></CCol>
            <CCol :md="12">
              <CFormLabel class="small fw-semibold">Tipos de recurso * <span class="text-medium-emphasis fw-normal">(seleccionar al menos uno)</span></CFormLabel>
              <div class="d-flex flex-wrap column-gap-3 mt-1">
                <CFormCheck v-for="(label, rt) in TEAM_RT_LABELS" :key="rt" :id="`create-rt-${rt}`"
                  :label="`${rt} — ${label}`"
                  :model-value="(teamForm.resourceTypes || []).includes(rt)"
                  @change="toggleTeamResourceType(teamForm, rt, $event.target.checked)" />
              </div>
            </CCol>
            <CCol :md="12"><CFormLabel class="small fw-semibold">Nombre *</CFormLabel>
              <CFormInput size="sm" placeholder="ej: DBA Cloud" v-model="teamForm.name" required /></CCol>
            <CCol :md="12"><CFormLabel class="small fw-semibold">Descripción</CFormLabel>
              <CFormTextarea size="sm" :rows="2" v-model="teamForm.description" /></CCol>
          </CRow>
        </CModalBody>
        <CModalFooter>
          <CButton color="secondary" variant="outline" @click="showTeamCreate = false" :disabled="saving">Cancelar</CButton>
          <CButton color="primary" type="submit" :disabled="saving"><CSpinner v-if="saving" size="sm" /><template v-else>Crear</template></CButton>
        </CModalFooter>
      </form>
    </CModal>

    <CModal :visible="showTeamEdit" @close="showTeamEdit = false">
      <CModalHeader><CModalTitle>Editar equipo — {{ selected?.code }}</CModalTitle></CModalHeader>
      <form @submit.prevent="handleTeamEdit">
        <CModalBody>
          <CAlert v-if="formError" color="danger" class="py-2 small">{{ formError }}</CAlert>
          <CustodyImpactWarning :impact="teamImpact" />
          <CRow class="g-3">
            <CCol :md="6"><CFormLabel class="small fw-semibold text-medium-emphasis">Código (no editable)</CFormLabel>
              <CFormInput size="sm" :value="teamForm.code" disabled /></CCol>
            <CCol :md="12">
              <CFormLabel class="small fw-semibold">Tipos de recurso * <span class="text-medium-emphasis fw-normal">(seleccionar al menos uno)</span></CFormLabel>
              <div class="d-flex flex-wrap column-gap-3 mt-1">
                <CFormCheck v-for="(label, rt) in TEAM_RT_LABELS" :key="rt" :id="`edit-rt-${rt}`"
                  :label="`${rt} — ${label}`"
                  :model-value="(teamForm.resourceTypes || []).includes(rt)"
                  @change="toggleTeamResourceType(teamForm, rt, $event.target.checked)" />
              </div>
            </CCol>
            <CCol :md="12"><CFormLabel class="small fw-semibold">Nombre *</CFormLabel>
              <CFormInput size="sm" v-model="teamForm.name" required /></CCol>
            <CCol :md="12"><CFormLabel class="small fw-semibold">Descripción</CFormLabel>
              <CFormTextarea size="sm" :rows="2" v-model="teamForm.description" /></CCol>
          </CRow>
        </CModalBody>
        <CModalFooter>
          <CButton color="secondary" variant="outline" @click="showTeamEdit = false" :disabled="saving">Cancelar</CButton>
          <CButton :color="teamImpact ? 'danger' : 'primary'" type="submit" :disabled="saving">
            <CSpinner v-if="saving" size="sm" /><template v-else>{{ teamImpact ? 'Guardar de todos modos' : 'Guardar' }}</template>
          </CButton>
        </CModalFooter>
      </form>
    </CModal>

    <CModal :visible="showTeamDelete" @close="showTeamDelete = false">
      <CModalHeader><CModalTitle>Eliminar equipo</CModalTitle></CModalHeader>
      <CModalBody>
        <CAlert v-if="formError" color="danger" class="py-2 small">{{ formError }}</CAlert>
        <p class="mb-1">¿Eliminar el equipo <strong>{{ selected?.code }} — {{ selected?.name }}</strong>?</p>
        <p class="text-medium-emphasis small mb-0">No es posible si hay usuarios asignados a este equipo.</p>
      </CModalBody>
      <CModalFooter>
        <CButton color="secondary" variant="outline" @click="showTeamDelete = false" :disabled="saving">Cancelar</CButton>
        <CButton color="danger" @click="handleTeamDelete" :disabled="saving"><CSpinner v-if="saving" size="sm" /><template v-else>Eliminar</template></CButton>
      </CModalFooter>
    </CModal>

    <!-- MODAL: Permisos del rol -->
    <CModal size="lg" :visible="showRolePerms" @close="showRolePerms = false">
      <CModalHeader>
        <CModalTitle>
          Permisos — {{ permsRole?.code }}
          <CBadge v-if="permsRole?.is_system" color="dark" class="ms-2 small">Sistema</CBadge>
        </CModalTitle>
      </CModalHeader>
      <CModalBody>
        <CAlert v-if="permsError" color="danger" class="py-2 small">{{ permsError }}</CAlert>
        <CustodyImpactWarning :impact="permsImpact" />
        <div v-if="permsLoading" class="d-flex justify-content-center py-4"><CSpinner /></div>
        <CRow v-else class="g-3">
          <CCol v-for="group in PERM_GROUPS" :key="group.label" :md="4">
            <template v-if="allPermissions.filter(p => group.codes.includes(p.code)).length">
              <div class="fw-semibold small mb-2 text-medium-emphasis text-uppercase" style="font-size: 11px; letter-spacing: 1px">{{ group.label }}</div>
              <div v-for="perm in allPermissions.filter(p => group.codes.includes(p.code))" :key="perm.id" class="mb-1">
                <!-- :label hace falta aunque se use el slot: sin la prop, CFormCheck
                     solo pinta la casilla e ignora #label (se veían casillas sin nombre). -->
                <CFormCheck :id="`perm-${perm.id}`" :label="perm.code"
                  :model-value="rolePermIds.has(perm.id)"
                  :disabled="esPermisoBloqueado(perm)"
                  @change="togglePerm(perm.id)">
                  <template #label>
                    <span class="fw-semibold" style="font-size: 12px">{{ perm.code }}</span>
                    <span class="text-medium-emphasis ms-1" style="font-size: 11px">— {{ perm.description }}</span>
                    <div v-if="esPermisoBloqueado(perm)" class="text-warning" style="font-size: 11px">
                      Obligatorio en roles ADMIN: sin él nadie podría volver a editar permisos.
                    </div>
                  </template>
                </CFormCheck>
              </div>
            </template>
          </CCol>
        </CRow>
      </CModalBody>
      <CModalFooter>
        <CButton v-if="permsRole?.is_system && ROLE_DEFAULT_PERMS[permsRole?.code] !== undefined"
          color="warning" variant="outline" size="sm" class="me-auto"
          @click="resetRolePermsToDefault" :disabled="permsSaving || permsLoading">
          Restaurar por defecto
        </CButton>
        <CButton color="secondary" variant="outline" @click="showRolePerms = false" :disabled="permsSaving">Cancelar</CButton>
        <CButton :color="permsImpact ? 'danger' : 'primary'" @click="handleSaveRolePerms" :disabled="permsSaving || permsLoading">
          <CSpinner v-if="permsSaving" size="sm" /><template v-else>{{ permsImpact ? 'Guardar de todos modos' : 'Guardar permisos' }}</template>
        </CButton>
      </CModalFooter>
    </CModal>

    <!-- MODALS: Proyecto -->
    <CModal :visible="showProjCreate" @close="showProjCreate = false">
      <CModalHeader><CModalTitle>Nuevo proyecto</CModalTitle></CModalHeader>
      <form @submit.prevent="handleProjCreate">
        <CModalBody>
          <CAlert v-if="formError" color="danger" class="py-2 small">{{ formError }}</CAlert>
          <CRow class="g-3">
            <CCol :md="8"><CFormLabel class="small fw-semibold">Nombre *</CFormLabel>
              <CFormInput size="sm" placeholder="ej: IS-Development" v-model="projForm.name" required /></CCol>
            <CCol :md="4"><CFormLabel class="small fw-semibold">Orden</CFormLabel>
              <CFormInput size="sm" type="number" :min="0" v-model.number="projForm.sortOrder" /></CCol>
            <CCol :md="12">
              <CFormLabel class="small fw-semibold">Infraestructura</CFormLabel>
              <CFormSelect size="sm" v-model="projForm.infrastructureId">
                <option value="">— Sin especificar —</option>
                <option v-for="i in infrastructures" :key="i.id" :value="String(i.id)">{{ i.code }} — {{ i.name }}</option>
              </CFormSelect>
            </CCol>
          </CRow>
        </CModalBody>
        <CModalFooter>
          <CButton color="secondary" variant="outline" @click="showProjCreate = false" :disabled="saving">Cancelar</CButton>
          <CButton color="primary" type="submit" :disabled="saving"><CSpinner v-if="saving" size="sm" /><template v-else>Crear</template></CButton>
        </CModalFooter>
      </form>
    </CModal>

    <CModal :visible="showProjEdit" @close="showProjEdit = false">
      <CModalHeader><CModalTitle>Editar proyecto — {{ selected?.code }}</CModalTitle></CModalHeader>
      <form @submit.prevent="handleProjEdit">
        <CModalBody>
          <CAlert v-if="formError" color="danger" class="py-2 small">{{ formError }}</CAlert>
          <CRow class="g-3">
            <CCol :md="4"><CFormLabel class="small fw-semibold text-medium-emphasis">Código (sistema)</CFormLabel>
              <CFormInput size="sm" :value="selected?.code || ''" disabled style="background: var(--cui-tertiary-bg); font-family: monospace" /></CCol>
            <CCol :md="5"><CFormLabel class="small fw-semibold">Nombre *</CFormLabel>
              <CFormInput size="sm" v-model="projForm.name" required /></CCol>
            <CCol :md="3"><CFormLabel class="small fw-semibold">Orden</CFormLabel>
              <CFormInput size="sm" type="number" :min="0" v-model.number="projForm.sortOrder" /></CCol>
            <CCol :md="12">
              <CFormLabel class="small fw-semibold">Infraestructura</CFormLabel>
              <CFormSelect size="sm" v-model="projForm.infrastructureId">
                <option value="">— Sin especificar —</option>
                <option v-for="i in infrastructures" :key="i.id" :value="String(i.id)">{{ i.code }} — {{ i.name }}</option>
              </CFormSelect>
            </CCol>
          </CRow>
        </CModalBody>
        <CModalFooter>
          <CButton color="secondary" variant="outline" @click="showProjEdit = false" :disabled="saving">Cancelar</CButton>
          <CButton color="primary" type="submit" :disabled="saving"><CSpinner v-if="saving" size="sm" /><template v-else>Guardar</template></CButton>
        </CModalFooter>
      </form>
    </CModal>

    <CModal :visible="showProjDelete" @close="showProjDelete = false">
      <CModalHeader><CModalTitle>Eliminar proyecto</CModalTitle></CModalHeader>
      <CModalBody>
        <CAlert v-if="formError" color="danger" class="py-2 small">{{ formError }}</CAlert>
        <p class="mb-1">¿Eliminar <strong>{{ selected?.code }} — {{ selected?.name }}</strong>?</p>
        <UsageWarning :usages="deleteUsages" />
        <p v-if="!deleteUsages?.length" class="text-medium-emphasis small mb-0">No es posible si hay servidores o servicios de BD que lo referencian.</p>
      </CModalBody>
      <CModalFooter>
        <CButton color="secondary" variant="outline" @click="showProjDelete = false" :disabled="saving">Cancelar</CButton>
        <CButton color="danger" @click="handleProjDelete" :disabled="saving || usagesLoading || deleteUsages?.length > 0"><CSpinner v-if="saving" size="sm" /><template v-else>Eliminar</template></CButton>
      </CModalFooter>
    </CModal>

  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { Pencil, Trash2, Ban, CheckCircle2, Shield } from 'lucide-vue-next'
import api from '../../api/index.js'
import SimpleCatalogTab from '../../components/catalogs/SimpleCatalogTab.vue'
import UsageWarning from '../../components/catalogs/UsageWarning.vue'
import CustodyImpactWarning from '../../components/catalogs/CustodyImpactWarning.vue'

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------
const PERM_GROUPS = [
  { label: 'Credenciales', codes: ['CRED_VIEW', 'CRED_EDIT', 'CRED_DELETE', 'CRED_REVEAL'] },
  { label: 'Recursos',     codes: ['RES_VIEW', 'RES_EDIT', 'RES_DELETE'] },
  { label: 'Módulos',      codes: ['MOD_PWDGEN', 'MOD_USERS', 'MOD_AUDIT', 'AUDIT_TEAM', 'MOD_CATALOGS', 'MOD_SECURITY', 'MOD_SYSTEM'] },
]
const ROLE_DEFAULT_PERMS = {
  VISITOR:  ['MOD_PWDGEN'],
  VIEWER:   ['MOD_PWDGEN', 'CRED_VIEW', 'RES_VIEW'],
  OPERATOR: ['MOD_PWDGEN', 'CRED_VIEW', 'CRED_EDIT', 'CRED_DELETE', 'CRED_REVEAL', 'RES_VIEW', 'RES_EDIT', 'RES_DELETE'],
  LEADER:   ['MOD_PWDGEN', 'CRED_VIEW', 'CRED_EDIT', 'CRED_DELETE', 'CRED_REVEAL', 'RES_VIEW', 'RES_EDIT', 'RES_DELETE', 'AUDIT_TEAM'],
  ADMIN:    null,
}
// Mismos colores por tipo que las insignias de equipos (TEAM_RT_COLORS), las
// credenciales y el dashboard: antes esta ficha pintaba DB del color que el
// resto de la app usa para otro tipo.
const RESOURCE_TYPES = [
  { code: 'DB', label: 'Base de datos', color: 'info', credential: 'Credenciales de BD', description: 'Equipos de bases de datos. Gestionan credenciales de acceso a instancias de BD.' },
  { code: 'OS', label: 'Sistema operativo', color: 'warning', credential: 'Credenciales de servidor', description: 'Equipos de infraestructura de servidores. Gestionan credenciales de acceso a sistemas operativos.' },
  { code: 'APP', label: 'Aplicación', color: 'success', credential: 'Credenciales de aplicación', description: 'Equipos de aplicaciones. Gestionan credenciales de acceso a aplicaciones.' },
  { code: 'NET', label: 'Networking', color: 'primary', credential: 'Credenciales de red', description: 'Equipos de redes. Gestionan credenciales de acceso a routers, switches, firewalls y demás dispositivos de red.' },
]
// Casillas de tipos de recurso en el formulario de equipos, e insignias del listado.
const TEAM_RT_LABELS = { DB: 'Bases de datos', OS: 'Servidores', APP: 'Aplicaciones', NET: 'Dispositivos de red' }
const TEAM_RT_COLORS = { DB: 'info', OS: 'warning', APP: 'success', NET: 'primary' }

const EMPTY_ENV   = { code: '', name: '', description: '', prdFlag: false, sortOrder: 0 }
const EMPTY_INFRA = { code: '', name: '', description: '' }
const EMPTY_ROLE  = { code: '', name: '', level: 50, description: '' }
const EMPTY_TEAM  = { code: '', name: '', resourceTypes: ['DB'], description: '' }
const EMPTY_PROJ  = { name: '', infrastructureId: '', sortOrder: 0 }

// ---------------------------------------------------------------------------
// Estado principal
// ---------------------------------------------------------------------------
const tab      = ref('environments')
const loading  = ref(true)
const error    = ref(null)
const catPage  = ref(1)
const catLimit = ref(15)

const environments    = ref([])
const infrastructures = ref([])
const roles           = ref([])
const teams           = ref([])
const projects        = ref([])

// Refs a SimpleCatalogTab
const catOsRef        = ref(null)
const catServerRef    = ref(null)
const catDbProductRef = ref(null)
const catDbEngineRef  = ref(null)
const catNetworkProductRef = ref(null)

// Modales
const showEnvCreate   = ref(false); const showEnvEdit    = ref(false); const showEnvDelete   = ref(false)
const showInfraCreate = ref(false); const showInfraEdit  = ref(false); const showInfraDelete = ref(false)
const showRoleCreate  = ref(false); const showRoleEdit   = ref(false); const showRoleDelete  = ref(false)
const showTeamCreate  = ref(false); const showTeamEdit   = ref(false); const showTeamDelete  = ref(false)
const showProjCreate  = ref(false); const showProjEdit   = ref(false); const showProjDelete  = ref(false)
const showRolePerms   = ref(false)

const selected  = ref(null)

// Qué elementos usan el registro que se quiere eliminar. Se consulta al abrir la
// ventana para avisar antes de confirmar; si la consulta falla, el backend sigue
// bloqueando el borrado y su mensaje aparece al confirmar.
const deleteUsages  = ref(null)
const usagesLoading = ref(false)
async function loadUsages(url) {
  deleteUsages.value = null; usagesLoading.value = true
  try { deleteUsages.value = (await api.get(url)).usages || [] }
  catch { deleteUsages.value = null }
  finally { usagesLoading.value = false }
}
const envForm   = reactive({ ...EMPTY_ENV })
const infraForm = reactive({ ...EMPTY_INFRA })
const roleForm  = reactive({ ...EMPTY_ROLE })
const teamForm  = reactive({ code: '', name: '', resourceTypes: ['DB'], description: '' })
const projForm  = reactive({ ...EMPTY_PROJ })
const formError = ref(null)
const saving    = ref(false)

// Permisos
const allPermissions = ref([])
const rolePermIds    = ref(new Set())
const permsRole      = ref(null)
const permsLoading   = ref(false)
const permsSaving    = ref(false)
const permsError     = ref(null)

// Credenciales custodiadas que el cambio dejaría sin nadie capaz de abrirlas
// (409 CUSTODY_IMPACT). Mientras hay aviso, "Guardar" reenvía con la
// confirmación; cualquier cambio en la selección lo descarta, para que lo que se
// confirma sea siempre lo que se va a guardar.
const permsImpact = ref(null)
const teamImpact  = ref(null)

// ---------------------------------------------------------------------------
// Paginación inline
// ---------------------------------------------------------------------------
function catPageOf(arr) { return arr.slice((catPage.value - 1) * catLimit.value, catPage.value * catLimit.value) }


// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------
async function load() {
  loading.value = true; error.value = null
  try {
    const data = await api.get('/catalogs')
    environments.value    = data.environments      || []
    infrastructures.value = data.infrastructures   || []
    roles.value           = data.roles             || []
    teams.value           = data.teams             || []
    projects.value        = data.projects          || []
  } catch (err) {
    error.value = err?.message || 'Error al cargar catálogos.'
  } finally { loading.value = false }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function levelColor(level) {
  if (level >= 100) return 'danger'
  if (level >= 50)  return 'warning'
  if (level >= 20)  return 'info'
  return 'secondary'
}

function toggleTeamResourceType(form, rt, checked) {
  teamImpact.value = null
  const current = form.resourceTypes || []
  form.resourceTypes = checked ? [...current, rt] : current.filter(x => x !== rt)
}

// ---------------------------------------------------------------------------
// Environments CRUD
// ---------------------------------------------------------------------------
async function handleEnvCreate() {
  saving.value = true; formError.value = null
  try { await api.post('/catalogs/environments', { ...envForm }); showEnvCreate.value = false; load() }
  catch (err) { formError.value = err?.message || 'Error al crear.' }
  finally { saving.value = false }
}
function openEnvEdit(env) {
  selected.value = env
  Object.assign(envForm, { code: env.code, name: env.name, description: env.description || '', prdFlag: env.prd_flag, sortOrder: env.sort_order })
  formError.value = null; showEnvEdit.value = true
}
async function handleEnvEdit() {
  saving.value = true; formError.value = null
  try { await api.put(`/catalogs/environments/${selected.value.id}`, { ...envForm }); showEnvEdit.value = false; load() }
  catch (err) { formError.value = err?.message || 'Error al actualizar.' }
  finally { saving.value = false }
}
async function handleEnvToggle(env) {
  try { await api.patch(`/catalogs/environments/${env.id}/toggle-estado`); load() }
  catch (err) { error.value = err?.message || 'Error al cambiar estado.' }
}
function openEnvDelete(env) {
  selected.value = env; formError.value = null; showEnvDelete.value = true
  loadUsages(`/catalogs/environments/${env.id}/usages`)
}
async function handleEnvDelete() {
  saving.value = true; formError.value = null
  try { await api.delete(`/catalogs/environments/${selected.value.id}`); showEnvDelete.value = false; load() }
  catch (err) { formError.value = err?.message || 'Error al eliminar.' }
  finally { saving.value = false }
}

// ---------------------------------------------------------------------------
// Infrastructures CRUD
// ---------------------------------------------------------------------------
async function handleInfraCreate() {
  saving.value = true; formError.value = null
  try { await api.post('/catalogs/infrastructures', { ...infraForm }); showInfraCreate.value = false; load() }
  catch (err) { formError.value = err?.message || 'Error al crear.' }
  finally { saving.value = false }
}
function openInfraEdit(infra) {
  selected.value = infra
  Object.assign(infraForm, { code: infra.code, name: infra.name, description: infra.description || '' })
  formError.value = null; showInfraEdit.value = true
}
async function handleInfraEdit() {
  saving.value = true; formError.value = null
  try { await api.put(`/catalogs/infrastructures/${selected.value.id}`, { ...infraForm }); showInfraEdit.value = false; load() }
  catch (err) { formError.value = err?.message || 'Error al actualizar.' }
  finally { saving.value = false }
}
async function handleInfraToggle(infra) {
  try { await api.patch(`/catalogs/infrastructures/${infra.id}/toggle-estado`); load() }
  catch (err) { error.value = err?.message || 'Error al cambiar estado.' }
}
function openInfraDelete(infra) {
  selected.value = infra; formError.value = null; showInfraDelete.value = true
  loadUsages(`/catalogs/infrastructures/${infra.id}/usages`)
}
async function handleInfraDelete() {
  saving.value = true; formError.value = null
  try { await api.delete(`/catalogs/infrastructures/${selected.value.id}`); showInfraDelete.value = false; load() }
  catch (err) { formError.value = err?.message || 'Error al eliminar.' }
  finally { saving.value = false }
}

// ---------------------------------------------------------------------------
// Roles CRUD
// ---------------------------------------------------------------------------
async function handleRoleCreate() {
  saving.value = true; formError.value = null
  try { await api.post('/catalogs/roles', { ...roleForm }); showRoleCreate.value = false; load() }
  catch (err) { formError.value = err?.message || 'Error al crear.' }
  finally { saving.value = false }
}
function openRoleEdit(role) {
  selected.value = role
  Object.assign(roleForm, { code: role.code, name: role.name, level: role.level, description: role.description || '' })
  formError.value = null; showRoleEdit.value = true
}
async function handleRoleEdit() {
  saving.value = true; formError.value = null
  try { await api.put(`/catalogs/roles/${selected.value.id}`, { ...roleForm }); showRoleEdit.value = false; load() }
  catch (err) { formError.value = err?.message || 'Error al actualizar.' }
  finally { saving.value = false }
}
async function handleRoleToggle(role) {
  try { await api.patch(`/catalogs/roles/${role.id}/toggle-estado`); load() }
  catch (err) { error.value = err?.message || 'Error al cambiar estado.' }
}
function openRoleDelete(role) { selected.value = role; formError.value = null; showRoleDelete.value = true }
async function handleRoleDelete() {
  saving.value = true; formError.value = null
  try { await api.delete(`/catalogs/roles/${selected.value.id}`); showRoleDelete.value = false; load() }
  catch (err) { formError.value = err?.message || 'Error al eliminar.' }
  finally { saving.value = false }
}

// ---------------------------------------------------------------------------
// Teams CRUD
// ---------------------------------------------------------------------------
async function handleTeamCreate() {
  saving.value = true; formError.value = null
  try { await api.post('/catalogs/teams', { ...teamForm }); showTeamCreate.value = false; load() }
  catch (err) { formError.value = err?.message || 'Error al crear.' }
  finally { saving.value = false }
}
function openTeamEdit(team) {
  selected.value = team
  Object.assign(teamForm, { code: team.code, name: team.name, resourceTypes: [...(team.resource_types || [])], description: team.description || '' })
  formError.value = null; teamImpact.value = null; showTeamEdit.value = true
}
async function handleTeamEdit() {
  saving.value = true; formError.value = null
  try {
    // Tras el aviso, el mismo botón reenvía con la confirmación.
    const body = teamImpact.value ? { ...teamForm, confirmCustodyImpact: true } : { ...teamForm }
    await api.put(`/catalogs/teams/${selected.value.id}`, body)
    showTeamEdit.value = false; teamImpact.value = null; load()
  } catch (err) {
    if (err?.code === 'CUSTODY_IMPACT') teamImpact.value = err.impact || []
    else formError.value = err?.message || 'Error al actualizar.'
  }
  finally { saving.value = false }
}
async function handleTeamToggle(team) {
  try { await api.patch(`/catalogs/teams/${team.id}/toggle-estado`); load() }
  catch (err) { error.value = err?.message || 'Error al cambiar estado.' }
}
function openTeamDelete(team) { selected.value = team; formError.value = null; showTeamDelete.value = true }
async function handleTeamDelete() {
  saving.value = true; formError.value = null
  try { await api.delete(`/catalogs/teams/${selected.value.id}`); showTeamDelete.value = false; load() }
  catch (err) { formError.value = err?.message || 'Error al eliminar.' }
  finally { saving.value = false }
}

// ---------------------------------------------------------------------------
// Projects CRUD
// ---------------------------------------------------------------------------
async function handleProjCreate() {
  saving.value = true; formError.value = null
  try { await api.post('/catalogs/projects', { ...projForm }); showProjCreate.value = false; load() }
  catch (err) { formError.value = err?.message || 'Error al crear.' }
  finally { saving.value = false }
}
function openProjEdit(proj) {
  selected.value = proj
  Object.assign(projForm, { name: proj.name, infrastructureId: proj.infrastructure_id ? String(proj.infrastructure_id) : '', sortOrder: proj.sort_order ?? 0 })
  formError.value = null; showProjEdit.value = true
}
async function handleProjEdit() {
  saving.value = true; formError.value = null
  try { await api.put(`/catalogs/projects/${selected.value.id}`, { ...projForm }); showProjEdit.value = false; load() }
  catch (err) { formError.value = err?.message || 'Error al actualizar.' }
  finally { saving.value = false }
}
async function handleProjToggle(proj) {
  try { await api.patch(`/catalogs/projects/${proj.id}/toggle-estado`); load() }
  catch (err) { error.value = err?.message || 'Error al cambiar estado.' }
}
function openProjDelete(proj) {
  selected.value = proj; formError.value = null; showProjDelete.value = true
  loadUsages(`/catalogs/projects/${proj.id}/usages`)
}
async function handleProjDelete() {
  saving.value = true; formError.value = null
  try { await api.delete(`/catalogs/projects/${selected.value.id}`); showProjDelete.value = false; load() }
  catch (err) { formError.value = err?.message || 'Error al eliminar.' }
  finally { saving.value = false }
}

// ---------------------------------------------------------------------------
// Role Permissions
// ---------------------------------------------------------------------------
async function openRolePerms(role) {
  permsRole.value = role; permsError.value = null; permsImpact.value = null; showRolePerms.value = true; permsLoading.value = true
  try {
    const [allPerms, rPerms] = await Promise.all([
      api.get('/catalogs/permissions'),
      api.get(`/catalogs/roles/${role.id}/permissions`),
    ])
    allPermissions.value = allPerms.permissions || []
    rolePermIds.value    = new Set((rPerms.permissions || []).map(p => p.id))
  } catch (err) {
    permsError.value = err?.message || 'Error al cargar permisos.'
  } finally { permsLoading.value = false }
}

// MOD_CATALOGS no se puede quitar a un rol de nivel ADMIN: es el permiso que
// abre esta pantalla, y sin él ningún administrador podría devolverlo. El
// backend lo rechaza igualmente; aquí se deshabilita para no ofrecer la opción.
function esPermisoBloqueado(perm) {
  return (permsRole.value?.level || 0) >= 100 && perm.code === 'MOD_CATALOGS'
}

function togglePerm(permId) {
  permsImpact.value = null
  const next = new Set(rolePermIds.value)
  if (next.has(permId)) next.delete(permId); else next.add(permId)
  rolePermIds.value = next
}

async function handleSaveRolePerms() {
  permsSaving.value = true; permsError.value = null
  try {
    // Tras el aviso, el mismo botón reenvía con la confirmación.
    const body = { permissionIds: [...rolePermIds.value] }
    if (permsImpact.value) body.confirmCustodyImpact = true
    await api.put(`/catalogs/roles/${permsRole.value.id}/permissions`, body)
    showRolePerms.value = false; permsImpact.value = null
  } catch (err) {
    if (err?.code === 'CUSTODY_IMPACT') permsImpact.value = err.impact || []
    else permsError.value = err?.message || 'Error al guardar permisos.'
  } finally { permsSaving.value = false }
}

function resetRolePermsToDefault() {
  if (!permsRole.value || !allPermissions.value.length) return
  permsImpact.value = null
  const defaultCodes = ROLE_DEFAULT_PERMS[permsRole.value.code]
  if (defaultCodes === null) {
    rolePermIds.value = new Set(allPermissions.value.map(p => p.id))
  } else if (defaultCodes) {
    rolePermIds.value = new Set(allPermissions.value.filter(p => defaultCodes.includes(p.code)).map(p => p.id))
  }
}

onMounted(load)
</script>
