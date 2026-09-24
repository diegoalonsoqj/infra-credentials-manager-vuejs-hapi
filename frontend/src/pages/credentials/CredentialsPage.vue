<template>
  <div style="height: 100%; overflow-y: auto; background: var(--cui-tertiary-bg); padding: 1.5rem">
    <CContainer>

      <!-- Header -->
      <div class="d-flex align-items-center justify-content-end mb-4">
        <CButton v-if="canWrite" color="primary" size="sm" @click="openCreate">+ Nueva credencial</CButton>
      </div>

      <!-- Filtros -->
      <CCard class="shadow-sm mb-3">
        <CCardBody class="py-2">
          <form @submit.prevent="handleSearch">
            <div class="d-flex gap-2 flex-wrap align-items-center">
              <CFormInput size="sm" placeholder="Buscar por usuario, recurso..."
                v-model="search" style="min-width: 180px; flex: 1" />
              <CFormSelect size="sm" v-model="filterEnv"
                @change="filterEnv = $event.target.value; page = 1"
                style="min-width: 130px; max-width: 160px">
                <option value="" disabled hidden>Ambiente</option>
                <option v-for="e in environments" :key="e.id" :value="String(e.id)">{{ e.name }}</option>
              </CFormSelect>
              <CFormSelect v-if="isAdmin" size="sm" v-model="filterType"
                @change="filterType = $event.target.value; page = 1"
                style="min-width: 100px; max-width: 120px">
                <option value="" disabled hidden>Tipo</option>
                <option value="DB">DB</option>
                <option value="OS">OS</option>
                <option value="APP">APP</option>
                <option value="NET">NET</option>
              </CFormSelect>
              <CFormSelect size="sm" v-model="filterEstado"
                @change="filterEstado = $event.target.value; page = 1"
                style="min-width: 110px; max-width: 130px">
                <option value="" disabled hidden>Estado</option>
                <option value="AI">Activa</option>
                <option value="IN">Inactiva</option>
              </CFormSelect>
              <CFormSelect size="sm" v-model="filterCustodied"
                @change="filterCustodied = $event.target.value; page = 1"
                style="min-width: 120px; max-width: 140px">
                <option value="" disabled hidden>Custodia</option>
                <option value="true">Custodiada</option>
                <option value="false">Sin custodia</option>
              </CFormSelect>
              <CButton type="submit" color="primary" variant="outline" size="sm">Buscar</CButton>
              <CButton v-if="search || filterEnv || filterType || filterEstado || filterCustodied !== ''"
                color="secondary" variant="outline" size="sm" @click="clearFilters">✕</CButton>
            </div>
          </form>
        </CCardBody>
      </CCard>

      <!-- Tabla -->
      <CCard class="shadow-sm">
        <CCardBody class="p-0">
          <div v-if="loading" class="d-flex justify-content-center py-4">
            <CSpinner size="sm" />
          </div>
          <CAlert v-else-if="listError" color="danger" class="m-3">{{ listError }}</CAlert>
          <p v-else-if="credentials.length === 0" class="text-center text-medium-emphasis small py-4 mb-0">
            Sin credenciales. <template v-if="canWrite">Crea la primera con el botón +.</template>
          </p>
          <CTable v-else small hover responsive class="mb-0" style="font-size: 13px">
            <CTableHead>
              <CTableRow>
                <CTableHeaderCell>Usuario</CTableHeaderCell>
                <CTableHeaderCell>Recurso</CTableHeaderCell>
                <CTableHeaderCell>Ambiente</CTableHeaderCell>
                <CTableHeaderCell>Estado</CTableHeaderCell>
                <CTableHeaderCell>Custodia</CTableHeaderCell>
                <CTableHeaderCell>Acciones</CTableHeaderCell>
              </CTableRow>
            </CTableHead>
            <CTableBody>
              <CTableRow v-for="cred in credentials" :key="cred.id">
                <CTableDataCell class="fw-semibold">{{ cred.username }}</CTableDataCell>
                <CTableDataCell>
                  <div class="d-flex align-items-center gap-1">
                    <CBadge :color="TYPE_COLORS[cred.resource_type] || 'info'" class="small">
                      {{ cred.resource_type }}
                    </CBadge>
                    <span>{{ resourceLabel(cred) }}</span>
                  </div>
                  <span class="font-monospace text-medium-emphasis" style="font-size: 11px">{{ instanceDetail(cred) }}</span>
                </CTableDataCell>
                <CTableDataCell>
                  {{ cred.environment_name || cred.environment_code || '—' }}
                  <CBadge v-if="cred.prd_flag" color="danger" class="ms-1 small">PRD</CBadge>
                </CTableDataCell>
                <CTableDataCell>
                  <CBadge :color="cred.estado === 'AI' ? 'success' : 'secondary'">
                    {{ cred.estado === 'AI' ? 'Activa' : 'Inactiva' }}
                  </CBadge>
                </CTableDataCell>
                <CTableDataCell>
                  <CBadge v-if="cred.is_custodied" color="warning" text-color="dark"
                    :title="`Custodio: ${cred.custodian_username || '?'}`">
                    <Lock :size="12" class="me-1" /> Custodiada
                  </CBadge>
                  <span v-else class="text-medium-emphasis" style="font-size: 11px">—</span>
                </CTableDataCell>
                <CTableDataCell>
                  <div class="d-flex gap-1">
                    <CButton color="secondary" size="sm" variant="outline" title="Ver detalle" @click="openDetail(cred)">
                      <Info :size="14" />
                    </CButton>
                    <template v-if="canReveal">
                      <CButton color="primary" size="sm" variant="outline"
                        :title="credRevealTip(cred)"
                        @click="openDecrypt(cred)"
                        :disabled="cred.estado !== 'AI' || (cred.is_custodied && !canOperateCustodied(cred))"
                        :style="{ opacity: (cred.estado !== 'AI' || (cred.is_custodied && !canOperateCustodied(cred))) ? 0.45 : 1 }">
                        <Unlock :size="14" />
                      </CButton>
                    </template>
                    <!-- Con acceso de consulta al tipo, solo se modifica lo del propio equipo -->
                    <template v-if="canWrite && authStore.canModifyOwned(cred.resource_type, cred.owner_team_id)">
                      <CButton color="info" size="sm" variant="outline"
                        :title="!canOperateCustodied(cred) ? `Solo el custodio (${cred.custodian_username}) puede editar` : 'Editar'"
                        @click="openEdit(cred)"
                        :disabled="!canOperateCustodied(cred)"
                        :style="{ opacity: canOperateCustodied(cred) ? 1 : 0.45 }">
                        <Pencil :size="14" />
                      </CButton>
                      <CButton :color="cred.estado === 'AI' ? 'secondary' : 'success'" size="sm" variant="outline"
                        :title="!canOperateCustodied(cred) ? `Solo el custodio (${cred.custodian_username}) puede cambiar estado` : (cred.estado === 'AI' ? 'Desactivar' : 'Activar')"
                        @click="handleToggle(cred)"
                        :disabled="!canOperateCustodied(cred)"
                        :style="{ opacity: canOperateCustodied(cred) ? 1 : 0.45 }">
                        <Ban v-if="cred.estado === 'AI'" :size="14" />
                        <CheckCircle2 v-else :size="14" />
                      </CButton>
                    </template>
                    <template v-if="canDelete && authStore.canModifyOwned(cred.resource_type, cred.owner_team_id)">
                      <CButton color="danger" size="sm" variant="outline"
                        :title="!canOperateCustodied(cred) ? `Solo el custodio (${cred.custodian_username}) puede eliminar` : 'Eliminar'"
                        @click="openDelete(cred)"
                        :disabled="!canOperateCustodied(cred)"
                        :style="{ opacity: canOperateCustodied(cred) ? 1 : 0.45 }">
                        <Trash2 :size="14" />
                      </CButton>
                    </template>
                    <template v-if="isAdmin && cred.is_custodied">
                      <CButton color="warning" size="sm" variant="outline"
                        :title="`Reasignar custodio (actual: ${cred.custodian_username || '?'})`"
                        @click="openReassign(cred)">
                        <User :size="14" />
                      </CButton>
                    </template>
                  </div>
                </CTableDataCell>
              </CTableRow>
            </CTableBody>
          </CTable>
        </CCardBody>
      </CCard>

      <!-- Footer paginación -->
      <div class="d-flex align-items-center justify-content-between gap-2 pt-2" style="font-size: 13px">
        <div class="d-flex align-items-center gap-2 text-medium-emphasis">
          <span>Mostrar:</span>
          <CFormSelect size="sm" style="width: auto" :model-value="limit"
            @change="limit = Number($event.target.value); page = 1">
            <option :value="10">10</option>
            <option :value="15">15</option>
            <option :value="25">25</option>
            <option :value="50">50</option>
          </CFormSelect>
          <span>{{ total === 0 ? 'Sin resultados' : `Mostrando ${(page - 1) * limit + 1}–${Math.min(page * limit, total)} de ${total}` }}</span>
        </div>
        <CPagination class="mb-0" size="sm">
          <CPaginationItem :disabled="page <= 1" @click="page > 1 && changePage(page - 1)"
            :style="{ cursor: page > 1 ? 'pointer' : 'default' }">«</CPaginationItem>
          <template v-for="(p, i) in paginationPages(page, totalPages)" :key="i">
            <CPaginationItem v-if="p === '...'" disabled>…</CPaginationItem>
            <CPaginationItem v-else :active="p === page" @click="changePage(p)" style="cursor: pointer">{{ p }}</CPaginationItem>
          </template>
          <CPaginationItem :disabled="page >= totalPages" @click="page < totalPages && changePage(page + 1)"
            :style="{ cursor: page < totalPages ? 'pointer' : 'default' }">»</CPaginationItem>
        </CPagination>
      </div>

    </CContainer>

    <!-- Modal: Crear credencial -->
    <CModal :visible="showCreate" @close="showCreate = false" size="lg" backdrop="static">
      <CModalHeader><CModalTitle>Nueva credencial</CModalTitle></CModalHeader>
      <form @submit.prevent="handleCreate">
        <CModalBody>
          <CAlert v-if="formError" color="danger" class="py-2 small">{{ formError }}</CAlert>
          <CRow class="g-3">
            <!-- ADMIN elige entre todos los tipos; un equipo con varios tipos, entre los suyos -->
            <CCol v-if="mustPickType" :md="12">
              <CFormLabel class="small fw-semibold">Tipo de recurso *</CFormLabel>
              <CFormSelect size="sm" v-model="createForm.resourceType"
                @change="createForm.resourceType = $event.target.value; createForm.instanceId = ''" required>
                <option value="">— Selecciona tipo —</option>
                <option v-for="t in creatableTypes" :key="t" :value="t">{{ TYPE_OPTION_LABELS[t] }}</option>
              </CFormSelect>
            </CCol>
            <CCol :md="12">
              <CFormLabel class="small fw-semibold">{{ INSTANCE_LABELS[effectiveResourceType] || 'Servicio de BD *' }}</CFormLabel>
              <CFormSelect size="sm" v-model="createForm.instanceId" required
                :disabled="mustPickType && !createForm.resourceType">
                <option value="">— Selecciona instancia —</option>
                <template v-if="effectiveResourceType === 'OS'">
                  <option v-for="inst in serverInstances" :key="inst.id" :value="String(inst.id)">
                    {{ serverInstanceLabel(inst) }}
                  </option>
                </template>
                <template v-else-if="effectiveResourceType === 'APP'">
                  <option v-for="inst in applications" :key="inst.id" :value="String(inst.id)">
                    {{ applicationInstanceLabel(inst) }}
                  </option>
                </template>
                <template v-else-if="effectiveResourceType === 'NET'">
                  <option v-for="inst in networkDevices" :key="inst.id" :value="String(inst.id)">
                    {{ networkInstanceLabel(inst) }}
                  </option>
                </template>
                <template v-else>
                  <option v-for="inst in dbInstances" :key="inst.id" :value="String(inst.id)">
                    {{ dbInstanceLabel(inst) }}
                  </option>
                </template>
              </CFormSelect>
            </CCol>
            <CCol :md="6">
              <CFormLabel class="small fw-semibold">Usuario *</CFormLabel>
              <CFormInput size="sm" placeholder="ej: app_readonly / root"
                v-model="createForm.username" required />
            </CCol>
            <CCol :md="6">
              <CFormLabel class="small fw-semibold">Contraseña *</CFormLabel>
              <CInputGroup size="sm">
                <CFormInput :type="showPassword ? 'text' : 'password'"
                  placeholder="Contraseña" v-model="createForm.password" required />
                <CButton color="secondary" variant="outline" @click="showPassword = !showPassword" type="button">
                  <EyeOff v-if="showPassword" :size="16" />
                  <Eye v-else :size="16" />
                </CButton>
              </CInputGroup>
              <PasswordGenerator :on-use="(pwd) => createForm.password = pwd" />
            </CCol>
            <CCol :md="12">
              <CFormLabel class="small fw-semibold">Descripción</CFormLabel>
              <CFormInput size="sm" placeholder="Descripción breve" v-model="createForm.description" />
            </CCol>
            <CCol :md="12">
              <CFormLabel class="small fw-semibold">Notas</CFormLabel>
              <CFormTextarea size="sm" :rows="2" placeholder="Notas adicionales" v-model="createForm.notes" />
            </CCol>
            <template v-if="canWrite">
              <CCol :md="12">
                <CFormCheck id="isCustodied"
                  label="Credencial custodiada (solo el custodio puede descifrar esta contraseña)"
                  :model-value="createForm.isCustodied"
                  @change="onCustodyChange($event.target.checked)" />
              </CCol>
              <CCol v-if="createForm.isCustodied && isAdmin" :md="12">
                <CFormLabel class="small fw-semibold">Custodio *</CFormLabel>
                <CFormSelect size="sm" v-model="createForm.custodianUserId" required>
                  <option value="">— Selecciona custodio —</option>
                  <option v-for="u in activeUsers" :key="u.id" :value="String(u.id)">
                    {{ u.username }} — {{ u.full_name }} ({{ u.role }}{{ u.team ? ` / ${u.team}` : '' }})
                  </option>
                </CFormSelect>
              </CCol>
              <CCol v-if="createForm.isCustodied && !isAdmin" :md="12">
                <CAlert color="info" class="py-2 small mb-0">
                  Serás el custodio de esta credencial. Solo tú podrás descifrar la contraseña.
                </CAlert>
              </CCol>
            </template>
          </CRow>
        </CModalBody>
        <CModalFooter>
          <CButton color="secondary" variant="outline" @click="showCreate = false" :disabled="saving">Cancelar</CButton>
          <CButton color="primary" type="submit" :disabled="saving">
            <CSpinner v-if="saving" size="sm" />
            <template v-else>Crear credencial</template>
          </CButton>
        </CModalFooter>
      </form>
    </CModal>

    <!-- Modal: Editar credencial -->
    <CModal :visible="showEdit" @close="showEdit = false" size="lg">
      <CModalHeader><CModalTitle>Editar credencial — {{ selected?.username }}</CModalTitle></CModalHeader>
      <form @submit.prevent="handleEdit">
        <CModalBody>
          <CAlert v-if="formError" color="danger" class="py-2 small">{{ formError }}</CAlert>
          <CRow class="g-3">
            <CCol :md="12">
              <CFormLabel class="small fw-semibold text-medium-emphasis">Instancia (no editable)</CFormLabel>
              <CFormInput size="sm" :value="selected ? `[${selected.resource_type}] ${resourceCode(selected)} — ${resourceLabel(selected)} / ${selected.environment_code || '?'} — ${instanceDetail(selected)}` : ''" disabled />
            </CCol>
            <CCol :md="12">
              <CFormLabel class="small fw-semibold">Usuario *</CFormLabel>
              <CFormInput size="sm" v-model="editForm.username" required />
            </CCol>
            <CCol :md="12">
              <CFormLabel class="small fw-semibold">Descripción</CFormLabel>
              <CFormInput size="sm" v-model="editForm.description" />
            </CCol>
            <CCol :md="12">
              <CFormLabel class="small fw-semibold">Notas</CFormLabel>
              <CFormTextarea size="sm" :rows="2" v-model="editForm.notes" />
            </CCol>
            <CCol :md="12">
              <CFormLabel class="small fw-semibold">
                Nueva contraseña <span class="text-medium-emphasis">(dejar vacío para no cambiar)</span>
              </CFormLabel>
              <CInputGroup size="sm">
                <CFormInput :type="showNewPassword ? 'text' : 'password'"
                  placeholder="Nueva contraseña (opcional)" v-model="editForm.newPassword" />
                <CButton color="secondary" variant="outline" @click="showNewPassword = !showNewPassword" type="button">
                  <EyeOff v-if="showNewPassword" :size="16" />
                  <Eye v-else :size="16" />
                </CButton>
              </CInputGroup>
              <PasswordGenerator :on-use="(pwd) => editForm.newPassword = pwd" />
            </CCol>
          </CRow>
        </CModalBody>
        <CModalFooter>
          <CButton color="secondary" variant="outline" @click="showEdit = false" :disabled="saving">Cancelar</CButton>
          <CButton color="primary" type="submit" :disabled="saving">
            <CSpinner v-if="saving" size="sm" />
            <template v-else>Guardar cambios</template>
          </CButton>
        </CModalFooter>
      </form>
    </CModal>

    <!-- Modal: Eliminar -->
    <CModal :visible="showDelete" @close="showDelete = false">
      <CModalHeader><CModalTitle>Eliminar credencial</CModalTitle></CModalHeader>
      <CModalBody>
        <CAlert v-if="formError" color="danger" class="py-2 small">{{ formError }}</CAlert>
        <p class="mb-1">¿Eliminar la credencial <strong>{{ selected?.username }}</strong>
          <template v-if="selected"> en {{ resourceCode(selected) }}</template>?</p>
        <p class="text-medium-emphasis small mb-0">Esta acción es lógica e irreversible desde la interfaz.</p>
      </CModalBody>
      <CModalFooter>
        <CButton color="secondary" variant="outline" @click="showDelete = false" :disabled="saving">Cancelar</CButton>
        <CButton color="danger" @click="handleDelete" :disabled="saving">
          <CSpinner v-if="saving" size="sm" />
          <template v-else>Eliminar</template>
        </CButton>
      </CModalFooter>
    </CModal>

    <!-- Modal: Reasignar custodio -->
    <CModal :visible="showReassign" @close="showReassign = false" alignment="center">
      <CModalHeader>
        <CModalTitle><User :size="18" class="me-2" /> Reasignar custodio</CModalTitle>
      </CModalHeader>
      <CModalBody>
        <CAlert v-if="reassignError" color="danger" class="py-2 small">{{ reassignError }}</CAlert>
        <p class="small mb-1">
          Credencial: <strong>{{ selected?.username }}</strong> en <strong>{{ selected ? resourceLabel(selected) : '' }}</strong>
        </p>
        <CAlert color="warning" class="py-2 small mb-3">
          Custodio actual: <strong>{{ selected?.custodian_username || '—' }}</strong> — el nuevo custodio será el único que podrá operar sobre esta credencial.
        </CAlert>
        <CFormLabel class="small fw-semibold">Nuevo custodio *</CFormLabel>
        <CFormSelect size="sm" v-model="reassignUserId">
          <option value="">— Selecciona usuario —</option>
          <option v-for="u in activeUsers.filter(u => u.id !== selected?.custodian_user_id)" :key="u.id" :value="String(u.id)">
            {{ u.username }} — {{ u.full_name }} ({{ u.role }}{{ u.team ? ` / ${u.team}` : '' }})
          </option>
        </CFormSelect>
      </CModalBody>
      <CModalFooter>
        <CButton color="secondary" variant="outline" @click="showReassign = false" :disabled="reassignSaving">Cancelar</CButton>
        <CButton color="warning" @click="handleReassign" :disabled="!reassignUserId || reassignSaving">
          <CSpinner v-if="reassignSaving" size="sm" />
          <template v-else>Reasignar custodio</template>
        </CButton>
      </CModalFooter>
    </CModal>

    <!-- Modal: Confirmar custodia -->
    <CModal :visible="showCustodyConfirm" @close="showCustodyConfirm = false" backdrop="static">
      <CModalHeader>
        <CModalTitle><Lock :size="18" class="me-2" /> Confirmar credencial custodiada</CModalTitle>
      </CModalHeader>
      <CModalBody>
        <CAlert color="warning" class="small py-2"><strong>Atención — Lee esto antes de confirmar:</strong></CAlert>
        <ul class="small mb-2">
          <li class="mb-1">
            <template v-if="isAdmin">Solo el custodio seleccionado podrá descifrar esta contraseña, sin excepciones.</template>
            <template v-else>Solo tú podrás descifrar esta contraseña, sin excepciones — ni siquiera otro ADMIN podrá acceder a ella.</template>
          </li>
          <li class="mb-1">Si la cuenta del custodio es desactivada o eliminada, la credencial quedará <strong>congelada</strong>: nadie podrá descifrarla hasta que un ADMIN asigne un nuevo custodio.</li>
          <li>La custodia no se puede eliminar una vez creada la credencial; solo se puede reasignar desde administración.</li>
        </ul>
        <p class="small mb-0 text-medium-emphasis">¿Confirmas que esta credencial debe ser custodiada?</p>
      </CModalBody>
      <CModalFooter>
        <CButton color="secondary" variant="outline" @click="cancelCustody">Cancelar</CButton>
        <CButton color="warning" @click="confirmCustody">Sí, marcar como custodiada</CButton>
      </CModalFooter>
    </CModal>

    <!-- Modal: Detalle -->
    <CModal :visible="showDetail" @close="showDetail = false">
      <CModalHeader>
        <CModalTitle><Info :size="18" class="me-2" /> Detalle — {{ detailCred?.username }}</CModalTitle>
      </CModalHeader>
      <CModalBody class="py-3">
        <table v-if="detailCred" style="font-size: 13px; width: 100%; border-collapse: separate; border-spacing: 0 4px">
          <tbody>
            <tr>
              <td class="text-medium-emphasis pe-3" style="width: 38%; vertical-align: top">Usuario</td>
              <td class="fw-semibold font-monospace">{{ detailCred.username }}</td>
            </tr>
            <tr>
              <td class="text-medium-emphasis pe-3" style="vertical-align: top">Tipo</td>
              <td><CBadge :color="TYPE_COLORS[detailCred.resource_type] || 'info'">{{ detailCred.resource_type }}</CBadge></td>
            </tr>
            <tr>
              <td class="text-medium-emphasis pe-3" style="vertical-align: top">Recurso</td>
              <td>
                <span class="fw-semibold">{{ resourceLabel(detailCred) }}</span>
                <span class="text-medium-emphasis font-monospace ms-2" style="font-size: 11px">({{ resourceCode(detailCred) }})</span>
              </td>
            </tr>
            <tr>
              <td class="text-medium-emphasis pe-3" style="vertical-align: top">Conexión</td>
              <td class="font-monospace">{{ instanceDetail(detailCred) }}</td>
            </tr>
            <tr>
              <td class="text-medium-emphasis pe-3" style="vertical-align: top">Ambiente</td>
              <td>
                {{ detailCred.environment_name || detailCred.environment_code || '—' }}
                <CBadge v-if="detailCred.prd_flag" color="danger" class="ms-2">PRD</CBadge>
              </td>
            </tr>
            <tr>
              <td class="text-medium-emphasis pe-3" style="vertical-align: top">Estado</td>
              <td><CBadge :color="detailCred.estado === 'AI' ? 'success' : 'secondary'">{{ detailCred.estado === 'AI' ? 'Activa' : 'Inactiva' }}</CBadge></td>
            </tr>
            <tr>
              <td class="text-medium-emphasis pe-3" style="vertical-align: top">Equipo propietario</td>
              <td>
                <CBadge v-if="detailCred.owner_team_code" color="secondary">{{ detailCred.owner_team_code }}</CBadge>
                <span v-else class="text-medium-emphasis">— (sin equipo)</span>
              </td>
            </tr>
            <tr>
              <td class="text-medium-emphasis pe-3" style="vertical-align: top">Custodia</td>
              <td>
                <span v-if="detailCred.is_custodied" class="d-flex align-items-center gap-2">
                  <CBadge color="warning" text-color="dark"><Lock :size="11" class="me-1" />Custodiada</CBadge>
                  <span>{{ detailCred.custodian_full_name || detailCred.custodian_username || '—' }}</span>
                </span>
                <span v-else class="text-medium-emphasis">No</span>
              </td>
            </tr>
            <tr v-if="detailCred.description">
              <td class="text-medium-emphasis pe-3" style="vertical-align: top">Descripción</td>
              <td>{{ detailCred.description }}</td>
            </tr>
            <tr v-if="detailCred.notes">
              <td class="text-medium-emphasis pe-3" style="vertical-align: top">Notas</td>
              <td style="white-space: pre-wrap">{{ detailCred.notes }}</td>
            </tr>
            <tr><td colspan="2"><hr class="my-2" /></td></tr>
            <tr>
              <td class="text-medium-emphasis pe-3">Creada el</td>
              <td>{{ formatDate(detailCred.created_at) }}</td>
            </tr>
            <tr>
              <td class="text-medium-emphasis pe-3">Modificada el</td>
              <td>{{ formatDate(detailCred.updated_at) }}</td>
            </tr>
          </tbody>
        </table>
      </CModalBody>
      <CModalFooter>
        <CButton color="secondary" variant="outline" @click="showDetail = false">Cerrar</CButton>
      </CModalFooter>
    </CModal>

    <!-- Modal: Ver contraseña (decrypt) -->
    <CModal :visible="showDecrypt" @close="closeDecrypt" backdrop="static">
      <CModalHeader>
        <CModalTitle><Unlock :size="18" class="me-2" /> Contraseña — {{ selected?.username }}</CModalTitle>
      </CModalHeader>
      <CModalBody>
        <div v-if="decrypting" class="d-flex justify-content-center py-3">
          <CSpinner size="sm" />
          <span class="ms-2 small">Descifrando...</span>
        </div>
        <!-- Credencial de otro equipo con acceso de consulta: motivo antes de descifrar -->
        <form v-else-if="askReason" @submit.prevent="doDecrypt">
          <CAlert color="info" class="py-2 small mb-3">
            Esta credencial es de otro equipo. Indica el motivo del acceso: quedará en la
            auditoría, junto con tu usuario, y lo verán los responsables de esa área.
          </CAlert>
          <CAlert v-if="decryptError" color="danger" class="py-2 small">{{ decryptError }}</CAlert>
          <CFormLabel class="small fw-semibold">Motivo *</CFormLabel>
          <CFormTextarea v-model="decryptReason" rows="2" maxlength="500"
            placeholder="Ej: INC-1234, caída de la BD de ventas fuera de horario" />
          <div class="d-flex justify-content-end mt-3">
            <CButton type="submit" color="primary" size="sm" :disabled="decryptReason.trim().length < REASON_MIN">
              <Unlock :size="14" class="me-1" /> Descifrar
            </CButton>
          </div>
        </form>
        <CAlert v-else-if="decryptError" color="danger" class="py-2 small">{{ decryptError }}</CAlert>
        <template v-else-if="plainPassword">
          <CAlert color="warning" class="py-2 small mb-3">
            Esta ventana se cerrará automáticamente en <strong>{{ countdown }}s</strong>.
            No compartas esta contraseña.
          </CAlert>
          <CFormLabel class="small fw-semibold">Contraseña</CFormLabel>
          <CInputGroup>
            <CFormInput :type="showDecryptPwd ? 'text' : 'password'" :value="plainPassword"
              readonly style="font-family: monospace; font-size: 14px" />
            <CButton color="secondary" variant="outline"
              @click="showDecryptPwd = !showDecryptPwd"
              :title="showDecryptPwd ? 'Ocultar' : 'Mostrar'">
              <EyeOff v-if="showDecryptPwd" :size="16" />
              <Eye v-else :size="16" />
            </CButton>
            <CButton :color="copied ? 'success' : 'secondary'" variant="outline" @click="handleCopy">
              <Check v-if="copied" :size="16" />
              <ClipboardCopy v-else :size="16" />
            </CButton>
          </CInputGroup>
          <p class="text-medium-emphasis small mt-2 mb-0">
            [{{ selected?.resource_type }}] {{ selected ? resourceCode(selected) : '' }} — {{ selected ? resourceLabel(selected) : '' }} / {{ selected?.environment_code }} — {{ selected ? instanceDetail(selected) : '' }}
            <CBadge v-if="selected?.prd_flag" color="danger" class="ms-2">PRD</CBadge>
          </p>
        </template>
      </CModalBody>
      <CModalFooter>
        <CButton color="secondary" variant="outline" @click="closeDecrypt">Cerrar</CButton>
      </CModalFooter>
    </CModal>

  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue'
import { Eye, EyeOff, Lock, Unlock, Check, ClipboardCopy, Info, Pencil, Trash2, User, Ban, CheckCircle2 } from 'lucide-vue-next'
import api from '../../api/index.js'
import { copySecret, requestClipboardClear } from '../../utils/clipboard.js'
import { useAuthStore } from '../../store/authStore.js'
import { useSettingsStore } from '../../store/settingsStore.js'
import PasswordGenerator from '../../components/PasswordGenerator.vue'

const authStore    = useAuthStore()
const settingsStore = useSettingsStore()

const user          = computed(() => authStore.user)
const canWrite      = computed(() => authStore.hasPermission('CRED_EDIT'))
const canDelete     = computed(() => authStore.hasPermission('CRED_DELETE'))
const canReveal     = computed(() => authStore.hasPermission('CRED_REVEAL'))
const isAdmin       = computed(() => (user.value?.roleLevel || 0) >= 100)
const decryptTimeoutSecs = computed(() => Math.max(5, Math.min(300, settingsStore.decryptTimeoutSecs || 30)))

// Lista
const credentials = ref([])
const total       = ref(0)
const page        = ref(1)
const search      = ref('')
const loading     = ref(false)
const listError   = ref(null)
const limit       = ref(15)

// Filtros
const filterEnv       = ref('')
const filterType      = ref('')
const filterCustodied = ref('')
const filterEstado    = ref('')
const environments    = ref([])

// Catálogos
const dbInstances     = ref([])
const serverInstances = ref([])
const applications    = ref([])
const networkDevices  = ref([])
const activeUsers     = ref([])

// Color de la insignia y etiqueta del selector de recurso, por tipo.
const TYPE_COLORS     = { DB: 'info', OS: 'warning', APP: 'success', NET: 'primary' }
const INSTANCE_LABELS = { DB: 'Servicio de BD *', OS: 'Servidor *', APP: 'Aplicación *', NET: 'Dispositivo de red *' }

// Modals
const showCreate        = ref(false)
const showEdit          = ref(false)
const showDelete        = ref(false)
const showDecrypt       = ref(false)
const showDetail        = ref(false)
const showReassign      = ref(false)
const showCustodyConfirm = ref(false)

// Form state
const EMPTY_FORM = { instanceId: '', resourceType: '', username: '', password: '', description: '', notes: '', isCustodied: false, custodianUserId: '' }
const EMPTY_EDIT = { username: '', description: '', notes: '', newPassword: '' }

const createForm    = reactive({ ...EMPTY_FORM })
const editForm      = reactive({ ...EMPTY_EDIT })
const selected      = ref(null)
const formError     = ref(null)
const saving        = ref(false)
const showPassword  = ref(false)
const showNewPassword = ref(false)

// Reassign
const reassignUserId  = ref('')
const reassignSaving  = ref(false)
const reassignError   = ref(null)

// Decrypt
const decrypting     = ref(false)
const decryptError   = ref(null)
const plainPassword  = ref('')
const countdown      = ref(0)
const copied         = ref(false)
const showDecryptPwd = ref(false)
// Motivo del acceso: lo exige el backend al descifrar, con acceso de consulta,
// una credencial de otro equipo. Queda en la auditoría.
const askReason      = ref(false)
const decryptReason  = ref('')
const REASON_MIN     = 5
const detailCred     = ref(null)
let countdownTimer = null

// Detail
const totalPages = computed(() => Math.ceil(total.value / limit.value) || 1)

const TYPE_OPTION_LABELS = {
  DB:  'BD (Base de datos — equipo DBA)',
  OS:  'OS (Servidor — equipo SYSADMIN)',
  APP: 'APP (Aplicación)',
  NET: 'NET (Dispositivo de red — equipo NETOPS)',
}
// Tipos entre los que se puede crear: todos para ADMIN, los del equipo para el resto.
const creatableTypes = computed(() =>
  isAdmin.value ? Object.keys(TYPE_OPTION_LABELS) : (user.value?.teamResourceTypes || [])
)
// Hay que elegir tipo si hay más de uno posible. Antes solo se ofrecía al ADMIN:
// un equipo con varios tipos (p. ej. NET y OS) veía recursos del primero y
// enviaba el tipo vacío, que el backend rechaza.
const mustPickType = computed(() => creatableTypes.value.length > 1)
const effectiveResourceType = computed(() =>
  mustPickType.value ? createForm.resourceType : (creatableTypes.value[0] || 'DB')
)

async function loadCredentials() {
  loading.value = true; listError.value = null
  try {
    const params = { page: page.value, limit: limit.value, search: search.value }
    if (filterEnv.value)              params.environmentId = filterEnv.value
    if (filterType.value)             params.resourceType  = filterType.value
    if (filterCustodied.value !== '') params.custodied     = filterCustodied.value
    if (filterEstado.value)           params.estado        = filterEstado.value
    const data = await api.get('/credentials', { params })
    credentials.value = data.credentials || []
    total.value = data.total || 0
  } catch (err) {
    listError.value = err?.message || 'Error al cargar credenciales.'
  } finally { loading.value = false }
}

function handleSearch() { page.value = 1; loadCredentials() }
function clearFilters() {
  filterEnv.value = ''; filterType.value = ''; filterCustodied.value = ''
  filterEstado.value = ''; search.value = ''; page.value = 1; loadCredentials()
}
function changePage(p) { page.value = p }

async function openCreate() {
  Object.assign(createForm, EMPTY_FORM)
  formError.value = null; showPassword.value = false
  try {
    const data = await api.get('/credentials/catalogs')
    dbInstances.value     = data.dbInstances         || []
    serverInstances.value = data.serverInstances     || []
    applications.value    = data.applications        || []
    networkDevices.value  = data.networkDevices      || []
    activeUsers.value     = data.users               || []
  } catch {
    dbInstances.value = []; serverInstances.value = []; applications.value = []
    networkDevices.value = []; activeUsers.value = []
  }
  showCreate.value = true
}

async function handleCreate() {
  saving.value = true; formError.value = null
  try {
    // Se envía el tipo que se está mostrando: con un solo tipo posible el
    // formulario no lo pregunta y createForm.resourceType queda vacío.
    await api.post('/credentials', { ...createForm, resourceType: effectiveResourceType.value })
    showCreate.value = false; page.value = 1; loadCredentials()
  } catch (err) { formError.value = err?.message || 'Error al crear la credencial.' }
  finally { saving.value = false }
}

function openEdit(cred) {
  selected.value = cred
  Object.assign(editForm, { username: cred.username, description: cred.description || '', notes: cred.notes || '', newPassword: '' })
  formError.value = null; showNewPassword.value = false; showEdit.value = true
}

async function handleEdit() {
  saving.value = true; formError.value = null
  try {
    await api.put(`/credentials/${selected.value.id}`, { ...editForm })
    showEdit.value = false; loadCredentials()
  } catch (err) { formError.value = err?.message || 'Error al actualizar la credencial.' }
  finally { saving.value = false }
}

async function handleToggle(cred) {
  try { await api.patch(`/credentials/${cred.id}/toggle-estado`); loadCredentials() }
  catch (err) { listError.value = err?.message || 'Error al cambiar estado.' }
}

function openDelete(cred) { selected.value = cred; formError.value = null; showDelete.value = true }
async function handleDelete() {
  saving.value = true
  try { await api.delete(`/credentials/${selected.value.id}`); showDelete.value = false; loadCredentials() }
  catch (err) { formError.value = err?.message || 'Error al eliminar la credencial.' }
  finally { saving.value = false }
}

async function openReassign(cred) {
  selected.value = cred; reassignUserId.value = ''; reassignError.value = null
  if (activeUsers.value.length === 0) {
    try { const data = await api.get('/credentials/catalogs'); activeUsers.value = data.users || [] }
    catch { /* silencioso */ }
  }
  showReassign.value = true
}

async function handleReassign() {
  if (!reassignUserId.value) return
  reassignSaving.value = true; reassignError.value = null
  try {
    await api.patch(`/credentials/${selected.value.id}/custodian`, { newCustodianUserId: reassignUserId.value })
    showReassign.value = false; loadCredentials()
  } catch (err) { reassignError.value = err?.message || 'Error al reasignar el custodio.' }
  finally { reassignSaving.value = false }
}

function openDecrypt(cred) {
  selected.value = cred; plainPassword.value = ''; decryptError.value = null
  copied.value = false; countdown.value = decryptTimeoutSecs.value
  showDecryptPwd.value = false; showDecrypt.value = true
  decryptReason.value = ''
  // Credencial de otro equipo con acceso de consulta: primero se pide el motivo.
  askReason.value = authStore.needsDecryptReason(cred)
  if (!askReason.value) doDecrypt()
}

async function doDecrypt() {
  const cred = selected.value
  decryptError.value = null; decrypting.value = true
  try {
    const body = decryptReason.value.trim() ? { reason: decryptReason.value.trim() } : undefined
    const data = await api.post(`/credentials/${cred.id}/decrypt`, body)
    askReason.value = false
    plainPassword.value = data.plain_password || ''
    let secs = decryptTimeoutSecs.value
    countdownTimer = setInterval(() => {
      secs -= 1; countdown.value = secs
      if (secs <= 0) {
        clearInterval(countdownTimer)
        showDecrypt.value = false
        plainPassword.value = ''
        // La cuenta atras promete que el secreto es efimero: si el usuario lo
        // copio, la copia no debe sobrevivir al valor que acaba de borrarse.
        if (hasCopied) { hasCopied = false; requestClipboardClear() }
      }
    }, 1000)
  } catch (err) {
    // El backend decide: si pide motivo (p. ej. la sesión del navegador es
    // anterior al cambio de acceso del equipo), se muestra el paso del motivo.
    if (err?.code === 'REASON_REQUIRED') askReason.value = true
    decryptError.value = err?.message || 'No se pudo descifrar la contraseña.'
  } finally { decrypting.value = false }
}

function closeDecrypt() {
  clearInterval(countdownTimer)
  showDecrypt.value = false
  plainPassword.value = ''
  if (hasCopied) { hasCopied = false; requestClipboardClear() }
}

// Se recuerda si el usuario llego a copiar para no vaciar el portapapeles a
// ciegas: si nunca copio, lo que haya dentro es suyo y no debe tocarse.
let hasCopied = false

async function handleCopy() {
  const ok = await copySecret(plainPassword.value)
  if (!ok) {
    decryptError.value = 'No se pudo copiar al portapapeles. Copia el valor manualmente.'
    return
  }
  hasCopied = true
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}

function openDetail(cred) { detailCred.value = cred; showDetail.value = true }

function onCustodyChange(checked) {
  if (checked) { showCustodyConfirm.value = true }
  else { createForm.isCustodied = false; createForm.custodianUserId = '' }
}
function cancelCustody() { showCustodyConfirm.value = false; createForm.isCustodied = false; createForm.custodianUserId = '' }
function confirmCustody() { showCustodyConfirm.value = false; createForm.isCustodied = true }

// Helpers
function canOperateCustodied(cred) { return !cred.is_custodied || cred.custodian_user_id === user.value?.id }
function resourceCode(cred) {
  if (cred.resource_type === 'OS')  return cred.server_code || '—'
  if (cred.resource_type === 'APP') return cred.app_code    || '—'
  if (cred.resource_type === 'NET') return cred.net_code    || '—'
  return cred.db_code || '—'
}
function resourceLabel(cred) {
  if (cred.resource_type === 'OS')  return cred.server_name || cred.server_code || '—'
  if (cred.resource_type === 'APP') return cred.app_name    || cred.app_code    || '—'
  if (cred.resource_type === 'NET') return cred.net_name    || cred.net_code    || '—'
  return cred.db_name || cred.db_code || '—'
}
function instanceDetail(cred) {
  if (cred.resource_type === 'OS') return cred.server_hostname || cred.server_ip || '—'
  if (cred.resource_type === 'APP') return cred.app_url || cred.app_name || '—'
  if (cred.resource_type === 'NET') return cred.net_port ? `${cred.net_host}:${cred.net_port}` : (cred.net_host || '—')
  return `${cred.db_host || '—'}:${cred.db_port || '—'}`
}
function credRevealTip(cred) {
  const canOp = canOperateCustodied(cred)
  if (cred.is_custodied && !canOp) return `Solo el custodio (${cred.custodian_username}) puede ver esta contraseña`
  if (cred.estado !== 'AI') return 'Credencial inactiva'
  return 'Ver contraseña'
}
function dbInstanceLabel(inst) {
  return `${inst.code} — ${inst.name} / ${inst.environment_code}${inst.prd_flag ? ' [PRD]' : ''} — ${inst.host}:${inst.port}`
}
function serverInstanceLabel(inst) {
  return `${inst.code} — ${inst.name} / ${inst.environment_code}${inst.prd_flag ? ' [PRD]' : ''} — ${inst.hostname || inst.ip_address || 'N/A'}`
}
function applicationInstanceLabel(inst) {
  return `${inst.code} — ${inst.name} / ${inst.environment_code}${inst.prd_flag ? ' [PRD]' : ''}${inst.url ? ` — ${inst.url}` : ''}`
}
function networkInstanceLabel(inst) {
  return `${inst.code} — ${inst.name} / ${inst.environment_code}${inst.prd_flag ? ' [PRD]' : ''} — ${inst.host}${inst.port ? `:${inst.port}` : ''}`
}
function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-PE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function paginationPages(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages = [1]
  if (current > 3) pages.push('...')
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) pages.push(i)
  if (current < total - 2) pages.push('...')
  pages.push(total)
  return pages
}

watch([page, limit], loadCredentials)
watch([filterEnv, filterType, filterCustodied, filterEstado], () => { page.value = 1; loadCredentials() })

// Recargar o salir a otra dirección descarga la página sin desmontar nada: sin
// esto, la contraseña copiada se quedaba en el portapapeles. pagehide deja
// marcado el vaciado (utils/clipboard.js) y la aplicación lo completa al volver
// a cargarse en esta pestaña.
function onPageHide() {
  if (hasCopied) { hasCopied = false; requestClipboardClear() }
}

onMounted(() => {
  loadCredentials()
  api.get('/credentials/catalogs')
    .then(data => { environments.value = data.environments || [] })
    .catch(() => {})
  window.addEventListener('pagehide', onPageHide)
})
// Salir de la pagina cuenta como cerrar el dialogo: matar solo el temporizador
// dejaba sin ejecutar la limpieza que hacen closeDecrypt y el vencimiento de la
// cuenta atras, y la contrasena copiada se quedaba en el portapapeles de forma
// indefinida. Es el mismo defecto que cerro FE2, por la via del desmontaje.
onUnmounted(() => {
  window.removeEventListener('pagehide', onPageHide)
  clearInterval(countdownTimer)
  plainPassword.value = ''
  if (hasCopied) { hasCopied = false; requestClipboardClear() }
})
</script>
