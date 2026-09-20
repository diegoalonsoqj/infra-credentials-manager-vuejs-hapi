<template>
  <CSidebar
    class="icm-sidebar"
    color-scheme="dark"
    position="fixed"
    :narrow="narrow"
    :visible="visible"
    @visible-change="$emit('update:visible', $event)"
  >
    <!-- Brand -->
    <CSidebarBrand
      class="d-flex align-items-center gap-2 py-3"
      :style="{
        cursor: 'default',
        fontSize: '15px',
        fontWeight: 700,
        letterSpacing: 0.3,
        overflow: 'hidden',
        justifyContent: narrow ? 'center' : 'flex-start',
        paddingLeft: narrow ? 0 : '1rem',
        paddingRight: narrow ? 0 : '1rem',
      }"
    >
      <KeyRound :size="22" style="flex-shrink: 0" />
      <span v-if="!narrow" class="text-truncate">{{ settingsStore.appName }}</span>
    </CSidebarBrand>

    <CSidebarNav>

      <!-- Dashboard -->
      <CNavItem>
        <CNavLink
          :active="isActive('/dashboard')"
          @click="router.push('/dashboard')"
          :title="narrow ? 'Dashboard' : undefined"
          :style="narrow ? narrowLinkStyle : { cursor: 'pointer' }"
        >
          <span :class="narrow ? 'd-flex align-items-center justify-content-center w-100' : 'nav-icon d-flex align-items-center justify-content-center'">
            <LayoutDashboard :size="17" />
          </span>
          <template v-if="!narrow">Dashboard</template>
        </CNavLink>
      </CNavItem>

      <!-- Credenciales -->
      <CNavItem v-if="authStore.hasPermission('CRED_VIEW')">
        <CNavLink
          :active="isActive('/credentials')"
          @click="router.push('/credentials')"
          :title="narrow ? 'Credenciales' : undefined"
          :style="narrow ? narrowLinkStyle : { cursor: 'pointer' }"
        >
          <span :class="narrow ? 'd-flex align-items-center justify-content-center w-100' : 'nav-icon d-flex align-items-center justify-content-center'">
            <KeyRound :size="17" />
          </span>
          <template v-if="!narrow">Credenciales</template>
        </CNavLink>
      </CNavItem>

      <!-- Recursos -->
      <template v-if="canViewResources">
        <!-- Modo full: grupo colapsable, siempre abierto por defecto -->
        <CNavGroup v-if="!narrow" :visible="true">
          <template #toggler>
            <span class="nav-icon d-flex align-items-center justify-content-center"><Server :size="17" /></span>Recursos
          </template>
          <CNavItem v-if="canViewDB">
            <CNavLink :active="isActive('/resources/databases')" @click="router.push('/resources/databases')" style="cursor: pointer">
              <span class="nav-icon d-flex align-items-center justify-content-center"><Database :size="15" /></span>
              Bases de Datos
            </CNavLink>
          </CNavItem>
          <CNavItem v-if="canViewOS">
            <CNavLink :active="isActive('/resources/servers')" @click="router.push('/resources/servers')" style="cursor: pointer">
              <span class="nav-icon d-flex align-items-center justify-content-center"><Monitor :size="15" /></span>
              Servidores
            </CNavLink>
          </CNavItem>
          <CNavItem v-if="canViewAPP">
            <CNavLink :active="isActive('/resources/applications')" @click="router.push('/resources/applications')" style="cursor: pointer">
              <span class="nav-icon d-flex align-items-center justify-content-center"><Smartphone :size="15" /></span>
              Aplicaciones
            </CNavLink>
          </CNavItem>
        </CNavGroup>

        <!-- Modo narrow: items individuales -->
        <template v-else>
          <CNavItem v-if="canViewDB">
            <CNavLink :active="isActive('/resources/databases')" @click="router.push('/resources/databases')" title="Bases de Datos" :style="narrowLinkStyle">
              <span class="d-flex align-items-center justify-content-center w-100"><Database :size="17" /></span>
            </CNavLink>
          </CNavItem>
          <CNavItem v-if="canViewOS">
            <CNavLink :active="isActive('/resources/servers')" @click="router.push('/resources/servers')" title="Servidores" :style="narrowLinkStyle">
              <span class="d-flex align-items-center justify-content-center w-100"><Monitor :size="17" /></span>
            </CNavLink>
          </CNavItem>
          <CNavItem v-if="canViewAPP">
            <CNavLink :active="isActive('/resources/applications')" @click="router.push('/resources/applications')" title="Aplicaciones" :style="narrowLinkStyle">
              <span class="d-flex align-items-center justify-content-center w-100"><Smartphone :size="17" /></span>
            </CNavLink>
          </CNavItem>
        </template>
      </template>

      <!-- Generador de contraseñas -->
      <CNavItem v-if="authStore.hasPermission('MOD_PWDGEN')">
        <CNavLink
          :active="isActive('/tools/password-generator')"
          @click="router.push('/tools/password-generator')"
          :title="narrow ? 'Generador' : undefined"
          :style="narrow ? narrowLinkStyle : { cursor: 'pointer' }"
        >
          <span :class="narrow ? 'd-flex align-items-center justify-content-center w-100' : 'nav-icon d-flex align-items-center justify-content-center'">
            <LockKeyhole :size="17" />
          </span>
          <template v-if="!narrow">Generador</template>
        </CNavLink>
      </CNavItem>

      <!-- Auditoría -->
      <CNavItem v-if="authStore.hasPermission('MOD_AUDIT')">
        <CNavLink
          :active="isActive('/audit')"
          @click="router.push('/audit')"
          :title="narrow ? 'Auditoría' : undefined"
          :style="narrow ? narrowLinkStyle : { cursor: 'pointer' }"
        >
          <span :class="narrow ? 'd-flex align-items-center justify-content-center w-100' : 'nav-icon d-flex align-items-center justify-content-center'">
            <ClipboardList :size="17" />
          </span>
          <template v-if="!narrow">Auditoría</template>
        </CNavLink>
      </CNavItem>

      <CNavTitle v-if="hasAdminSection && !narrow">Administración</CNavTitle>

      <!-- Usuarios -->
      <CNavItem v-if="authStore.hasPermission('MOD_USERS')">
        <CNavLink
          :active="isActive('/admin/users')"
          @click="router.push('/admin/users')"
          :title="narrow ? 'Usuarios' : undefined"
          :style="narrow ? narrowLinkStyle : { cursor: 'pointer' }"
        >
          <span :class="narrow ? 'd-flex align-items-center justify-content-center w-100' : 'nav-icon d-flex align-items-center justify-content-center'">
            <Users :size="17" />
          </span>
          <template v-if="!narrow">Usuarios</template>
        </CNavLink>
      </CNavItem>

      <!-- Catálogos -->
      <CNavItem v-if="authStore.hasPermission('MOD_CATALOGS')">
        <CNavLink
          :active="isActive('/admin/catalogs')"
          @click="router.push('/admin/catalogs')"
          :title="narrow ? 'Catálogos' : undefined"
          :style="narrow ? narrowLinkStyle : { cursor: 'pointer' }"
        >
          <span :class="narrow ? 'd-flex align-items-center justify-content-center w-100' : 'nav-icon d-flex align-items-center justify-content-center'">
            <Settings :size="17" />
          </span>
          <template v-if="!narrow">Catálogos</template>
        </CNavLink>
      </CNavItem>

      <!-- Configuración del Sistema -->
      <CNavItem v-if="authStore.hasPermission('MOD_SYSTEM')">
        <CNavLink
          :active="isActive('/admin/system')"
          @click="router.push('/admin/system')"
          :title="narrow ? 'Configuración' : undefined"
          :style="narrow ? narrowLinkStyle : { cursor: 'pointer' }"
        >
          <span :class="narrow ? 'd-flex align-items-center justify-content-center w-100' : 'nav-icon d-flex align-items-center justify-content-center'">
            <Wrench :size="17" />
          </span>
          <template v-if="!narrow">Configuración</template>
        </CNavLink>
      </CNavItem>

      <!-- Rotación de Clave -->
      <CNavItem v-if="authStore.hasPermission('MOD_SECURITY')">
        <CNavLink
          :active="isActive('/security/key-rotation')"
          @click="router.push('/security/key-rotation')"
          :title="narrow ? 'Rotación de Clave' : undefined"
          :style="narrow ? narrowLinkStyle : { cursor: 'pointer' }"
        >
          <span :class="narrow ? 'd-flex align-items-center justify-content-center w-100' : 'nav-icon d-flex align-items-center justify-content-center'">
            <RotateCcw :size="17" />
          </span>
          <template v-if="!narrow">Rotación de Clave</template>
        </CNavLink>
      </CNavItem>

    </CSidebarNav>
  </CSidebar>
</template>

<script setup>
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  LayoutDashboard, KeyRound, Database, Monitor, Smartphone,
  LockKeyhole, ClipboardList, Users, Settings, RotateCcw,
  Wrench, Server,
} from 'lucide-vue-next'
import { useAuthStore } from '../../store/authStore.js'
import { useSettingsStore } from '../../store/settingsStore.js'

defineProps({
  visible: { type: Boolean, required: true },
  narrow:  { type: Boolean, required: true },
})
defineEmits(['update:visible'])

const router        = useRouter()
const route         = useRoute()
const authStore     = useAuthStore()
const settingsStore = useSettingsStore()

const narrowLinkStyle = { cursor: 'pointer', justifyContent: 'center', paddingLeft: 0, paddingRight: 0 }

function isActive(path) {
  return route.path === path || route.path.startsWith(path + '/')
}

const isAdmin          = computed(() => (authStore.user?.roleLevel || 0) >= 100)
const teamTypes        = computed(() => authStore.user?.teamResourceTypes || [])
const canViewDB        = computed(() => isAdmin.value || teamTypes.value.includes('DB'))
const canViewOS        = computed(() => isAdmin.value || teamTypes.value.includes('OS'))
const canViewAPP       = computed(() => isAdmin.value || teamTypes.value.includes('APP'))
const canViewResources = computed(() =>
  authStore.hasPermission('RES_VIEW') && (canViewDB.value || canViewOS.value || canViewAPP.value)
)
const hasAdminSection  = computed(() =>
  authStore.hasPermission('MOD_USERS') || authStore.hasPermission('MOD_CATALOGS') ||
  authStore.hasPermission('MOD_SYSTEM') || authStore.hasPermission('MOD_SECURITY')
)
</script>

<style>
/* El color de fondo del sidebar — no scoped porque CoreUI renderiza el div directamente */
.icm-sidebar {
  background: #1a2332 !important;
}
</style>
