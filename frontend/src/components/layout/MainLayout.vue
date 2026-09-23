<template>
  <div :style="{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--cui-body-bg)' }">
    <AppSidebar
      :visible="sidebarVisible"
      @update:visible="sidebarVisible = $event"
      :narrow="sidebarNarrow"
    />

    <!-- Botón toggle contraer/expandir sidebar: sobre el borde, a la altura de la cabecera -->
    <button
      v-if="sidebarVisible"
      @click="sidebarNarrow = !sidebarNarrow"
      :title="sidebarNarrow ? 'Expandir' : 'Contraer a iconos'"
      :aria-label="sidebarNarrow ? 'Expandir barra lateral' : 'Contraer barra lateral a iconos'"
      :style="{
        position: 'fixed',
        top: ((HEADER_HEIGHT - TOGGLE_SIZE) / 2) + 'px',
        left: (sidebarWidth - TOGGLE_SIZE / 2) + 'px',
        width: TOGGLE_SIZE + 'px',
        height: TOGGLE_SIZE + 'px',
        borderRadius: '50%',
        border: '1px solid rgba(255,255,255,0.2)',
        background: '#1a2332',
        color: 'rgba(255,255,255,0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        zIndex: 1100,
        padding: 0,
        boxShadow: '0 2px 6px rgba(0,0,0,0.35)',
        transition: 'left 0.2s ease',
      }"
    >
      <ChevronRight v-if="sidebarNarrow" :size="14" />
      <ChevronLeft v-else :size="14" />
    </button>

    <div
      :style="{
        marginLeft: sidebarWidth + 'px',
        transition: 'margin-left 0.2s ease',
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }"
    >
      <AppHeader @sidebar-toggle="sidebarVisible = !sidebarVisible" />

      <main :style="{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: 0 }">
        <RouterView />
      </main>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
import AppSidebar from './AppSidebar.vue'
import AppHeader from './AppHeader.vue'

const SIDEBAR_FULL   = 256  // 16rem — CoreUI default
const SIDEBAR_NARROW = 64   // 4rem  — CoreUI sidebar-narrow CSS class
const HEADER_HEIGHT  = 64   // 4rem  — CoreUI header y sidebar-brand (min-height)
const TOGGLE_SIZE    = 28

const sidebarVisible = ref(true)
const sidebarNarrow  = ref(false)

const sidebarWidth = computed(() =>
  sidebarVisible.value ? (sidebarNarrow.value ? SIDEBAR_NARROW : SIDEBAR_FULL) : 0
)
</script>
