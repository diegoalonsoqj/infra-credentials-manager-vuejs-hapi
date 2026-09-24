import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../store/authStore.js'
import MainLayout from '../components/layout/MainLayout.vue'

const routes = [
  {
    path: '/setup',
    component: () => import('../pages/setup/SetupWizard.vue'),
  },
  {
    path: '/login',
    component: () => import('../pages/auth/Login.vue'),
  },
  {
    path: '/',
    component: MainLayout,
    meta: { requiresAuth: true },
    children: [
      { path: '',          redirect: '/dashboard' },
      { path: 'dashboard', component: () => import('../pages/dashboard/Dashboard.vue') },
      { path: 'profile',   component: () => import('../pages/profile/ProfilePage.vue') },
      {
        path: 'credentials',
        component: () => import('../pages/credentials/CredentialsPage.vue'),
        meta: { permission: 'CRED_VIEW' },
      },
      {
        path: 'resources/databases',
        component: () => import('../pages/resources/DatabasesPage.vue'),
        meta: { permission: 'RES_VIEW', teamScope: 'DB' },
      },
      {
        path: 'resources/servers',
        component: () => import('../pages/resources/ServersPage.vue'),
        meta: { permission: 'RES_VIEW', teamScope: 'OS' },
      },
      {
        path: 'resources/applications',
        component: () => import('../pages/resources/ApplicationsPage.vue'),
        meta: { permission: 'RES_VIEW', teamScope: 'APP' },
      },
      {
        path: 'resources/network',
        component: () => import('../pages/resources/NetworkDevicesPage.vue'),
        meta: { permission: 'RES_VIEW', teamScope: 'NET' },
      },
      {
        path: 'tools/password-generator',
        component: () => import('../pages/tools/PasswordGeneratorPage.vue'),
        meta: { permission: 'MOD_PWDGEN' },
      },
      {
        path: 'audit',
        component: () => import('../pages/audit/AuditPage.vue'),
        meta: { anyPermission: ['MOD_AUDIT', 'AUDIT_TEAM'] },
      },
      {
        path: 'admin/users',
        component: () => import('../pages/admin/UsersPage.vue'),
        meta: { permission: 'MOD_USERS' },
      },
      {
        path: 'admin/catalogs',
        component: () => import('../pages/admin/CatalogsPage.vue'),
        meta: { permission: 'MOD_CATALOGS' },
      },
      {
        path: 'admin/system',
        component: () => import('../pages/admin/SystemSettingsPage.vue'),
        meta: { permission: 'MOD_SYSTEM' },
      },
      {
        path: 'security/key-rotation',
        component: () => import('../pages/security/KeyRotationPage.vue'),
        meta: { permission: 'MOD_SECURITY' },
      },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/dashboard' },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach((to) => {
  const authStore = useAuthStore()

  if (to.path === '/login' && authStore.isAuthenticated) {
    return '/dashboard'
  }

  const requiresAuth = to.matched.some(r => r.meta.requiresAuth)
  if (requiresAuth && !authStore.isAuthenticated) {
    return '/login'
  }

  if (to.meta.permission && !authStore.hasPermission(to.meta.permission)) {
    return '/dashboard'
  }
  // Basta con uno de varios permisos (la auditoría: MOD_AUDIT o AUDIT_TEAM).
  if (to.meta.anyPermission && !to.meta.anyPermission.some((p) => authStore.hasPermission(p))) {
    return '/dashboard'
  }

  if (to.meta.teamScope) {
    const user = authStore.user
    if (!user) return '/dashboard'
    const isAdmin = (user?.roleLevel || 0) >= 100
    const correctTeam = isAdmin || (user?.teamResourceTypes || []).includes(to.meta.teamScope)
    if (!correctTeam) return '/dashboard'
  }
})

export default router
