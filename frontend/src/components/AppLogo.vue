<template>
  <!-- Mismo dibujo que public/favicon.svg: si cambia uno, cambiar el otro. -->
  <svg
    :width="size" :height="size" viewBox="0 0 32 32"
    xmlns="http://www.w3.org/2000/svg" role="img" aria-label="ICM"
    style="flex-shrink: 0"
  >
    <defs>
      <linearGradient :id="gradId" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#6b69e0" />
        <stop offset="1" stop-color="#3f3db8" />
      </linearGradient>
    </defs>
    <!-- Fondo: color primario de CoreUI -->
    <rect width="32" height="32" rx="7" :fill="`url(#${gradId})`" />
    <!-- Escudo: seguridad -->
    <path d="M16 4.5 25.5 8v7c0 5.9-4 10.9-9.5 12.5C10.5 25.9 6.5 20.9 6.5 15V8Z" fill="#fff" />
    <!-- Cerradura: credenciales -->
    <circle cx="16" cy="13.6" r="2.9" fill="#3f3db8" />
    <path d="M14.6 15.4h2.8l.9 6.1h-4.6Z" fill="#3f3db8" />
  </svg>
</template>

<script setup>
import { useId } from 'vue'

defineProps({
  size: { type: [Number, String], default: 24 },
})

// Id único por instancia: con varios logos en la página, un id fijo haría
// que todos referencien el degradado del primero.
const gradId = `icm-logo-grad-${useId()}`
</script>
