<template>
  <RouterView />
</template>

<script setup>
import { onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from './store/authStore.js'
import { useSettingsStore } from './store/settingsStore.js'
import { setupApi } from './api/index.js'

const router = useRouter()
const authStore = useAuthStore()
const settingsStore = useSettingsStore()

onMounted(async () => {
  authStore.init()

  try {
    const data = await setupApi.getStatus()
    if (!data.installed && !window.location.pathname.startsWith('/setup')) {
      router.replace('/setup')
    } else if (data.installed && window.location.pathname.startsWith('/setup')) {
      router.replace('/login')
    }
    if (data.installed) {
      settingsStore.loadPublic()
    }
  } catch (err) {
    if (err?.code === 'SETUP_REQUIRED') {
      router.replace('/setup')
    }
  }
})

watch(
  () => settingsStore.theme,
  (theme) => {
    document.documentElement.setAttribute('data-coreui-theme', theme)
  },
  { immediate: true }
)
</script>
