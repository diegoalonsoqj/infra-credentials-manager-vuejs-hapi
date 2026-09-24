<template>
  <CHeader position="sticky" class="px-3 py-2 border-bottom shadow-sm">
    <div class="d-flex align-items-center w-100 gap-2">

      <!-- Toggle sidebar -->
      <CHeaderToggler
        @click="$emit('sidebar-toggle')"
        class="ps-1"
        style="border: none; background: none"
      >
        <Menu :size="20" />
      </CHeaderToggler>

      <!-- Page title -->
      <div v-if="page" class="d-flex align-items-center gap-2 ms-2">
        <span class="text-muted"><component :is="page.icon" :size="18" /></span>
        <span class="fw-semibold" style="font-size: 15px">{{ page.title }}</span>
      </div>

      <!-- Spacer -->
      <div class="flex-grow-1" />

      <!-- Botón tema claro/oscuro -->
      <button
        @click="settingsStore.toggleTheme()"
        :title="settingsStore.theme === 'light' ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro'"
        style="background: none; border: none; cursor: pointer; padding: 6px 8px; border-radius: 6px; display: flex; align-items: center; color: var(--cui-body-color)"
      >
        <Moon v-if="settingsStore.theme === 'light'" :size="18" />
        <Sun v-else :size="18" />
      </button>

      <!-- Menú usuario -->
      <CDropdown variant="nav-item" alignment="end">
        <CDropdownToggle
          :caret="false"
          class="d-flex align-items-center gap-2 px-2 py-1"
          style="background: none; border: none; cursor: pointer"
        >
          <CAvatar color="primary" size="sm" text-color="white">{{ initials }}</CAvatar>
          <span class="small fw-semibold d-none d-md-inline">{{ shortName }}</span>
        </CDropdownToggle>

        <CDropdownMenu style="min-width: 210px">
          <!-- Info del usuario -->
          <div class="px-3 py-2 border-bottom">
            <div class="fw-semibold small mb-1">{{ shortName }}</div>
            <div class="text-medium-emphasis" style="font-size: 11px">@{{ authStore.user?.username }}</div>
            <div class="d-flex align-items-center gap-1 flex-wrap">
              <CBadge :color="roleColor" class="px-2 py-1" style="font-size: 11px">
                {{ authStore.user?.role }}
              </CBadge>
              <CBadge v-if="authStore.user?.team" color="secondary" class="px-2 py-1" style="font-size: 11px">
                {{ authStore.user?.team }}
              </CBadge>
            </div>
          </div>

          <CDropdownItem
            style="cursor: pointer"
            @click="router.push('/profile')"
            class="d-flex align-items-center gap-2"
          >
            <UserCircle :size="15" />
            Mi Perfil
          </CDropdownItem>
          <CDropdownDivider />
          <CDropdownItem
            style="cursor: pointer; color: var(--cui-danger)"
            @click="handleLogout"
            class="d-flex align-items-center gap-2"
          >
            <LogOut :size="15" />
            Cerrar sesión
          </CDropdownItem>
        </CDropdownMenu>
      </CDropdown>

    </div>
  </CHeader>
</template>

<script setup>
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  Menu, LogOut, UserCircle, LayoutDashboard, KeyRound, Database,
  Monitor, Smartphone, LockKeyhole, ClipboardList, Users, Settings,
  Wrench, RotateCcw, Sun, Moon, Network,
} from 'lucide-vue-next'
import api from '../../api/index.js'
import { useAuthStore } from '../../store/authStore.js'
import { useSettingsStore } from '../../store/settingsStore.js'

defineEmits(['sidebar-toggle'])

const router       = useRouter()
const route        = useRoute()
const authStore    = useAuthStore()
const settingsStore = useSettingsStore()

const ROLE_COLORS = {
  ADMIN:    'danger',
  LEADER:   'dark',
  OPERATOR: 'primary',
  VIEWER:   'info',
  VISITOR:  'secondary',
}

const PAGE_MAP = {
  '/dashboard':                { title: 'Dashboard',                 icon: LayoutDashboard },
  '/credentials':              { title: 'Credenciales',              icon: KeyRound },
  '/resources/databases':      { title: 'Bases de Datos',            icon: Database },
  '/resources/servers':        { title: 'Servidores',                icon: Monitor },
  '/resources/applications':   { title: 'Aplicaciones',              icon: Smartphone },
  '/resources/network':        { title: 'Networking',                icon: Network },
  '/tools/password-generator': { title: 'Generador de Contraseñas',  icon: LockKeyhole },
  '/audit':                    { title: 'Auditoría',                 icon: ClipboardList },
  '/admin/users':              { title: 'Usuarios',                  icon: Users },
  '/admin/catalogs':           { title: 'Catálogos',                 icon: Settings },
  '/admin/system':             { title: 'Configuración del Sistema', icon: Wrench },
  '/security/key-rotation':    { title: 'Rotación de Clave',         icon: RotateCcw },
  '/profile':                  { title: 'Mi Perfil',                 icon: UserCircle },
}

const page = computed(() => PAGE_MAP[route.path] || null)

const shortName = computed(() => {
  const user = authStore.user
  const name = [
    (user?.firstName || '').split(' ')[0],
    (user?.lastName  || '').split(' ')[0],
  ].filter(Boolean).join(' ')
  return name || user?.fullName || user?.username || ''
})

const initials = computed(() =>
  shortName.value
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
)

const roleColor = computed(() => ROLE_COLORS[authStore.user?.role] || 'secondary')

async function handleLogout() {
  // La sesion real es la cookie HttpOnly icm_session: JavaScript no puede
  // borrarla, solo el servidor. Sin esta llamada el boton limpiaba el perfil de
  // sessionStorage y nada mas: la cookie seguia en el navegador y la sesion
  // seguia valida en BD hasta caducar, asi que en un equipo compartido el
  // siguiente usuario podia seguir usando la API como el anterior.
  try {
    await api.post('/auth/logout')
  } catch {
    // Sesion ya caducada o revocada (401): no queda nada que cerrar.
  }
  authStore.logout()
  router.replace('/login')
}
</script>
