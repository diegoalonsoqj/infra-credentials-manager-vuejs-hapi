<!--
  UsageWarning.vue — Aviso de "en uso" para las ventanas de eliminar catálogos.

  Muestra qué elementos usan el ambiente, la infraestructura o el proyecto que
  se quiere eliminar (GET /catalogs/.../{id}/usages). Mientras haya alguno, la
  ventana desactiva el botón: el backend rechazaría el borrado igualmente.
-->
<template>
  <CAlert v-if="usages && usages.length" color="warning" class="py-2 small mb-2">
    <strong>No se puede eliminar: está en uso por {{ usages.length }} elemento(s).</strong>
    <ul class="mb-1 mt-1 ps-3" style="max-height: 160px; overflow-y: auto">
      <li v-for="u in usages" :key="u.kind + u.code">
        {{ LABELS[u.kind] || u.kind }} <span class="font-monospace">{{ u.code }}</span> — {{ u.name }}
      </li>
    </ul>
    <div>Reasígnalos o elimínalos antes de eliminar este registro.</div>
  </CAlert>
</template>

<script setup>
defineProps({
  usages: { type: Array, default: null },
})

const LABELS = { SERVER: 'Servidor', DB_SERVICE: 'Servicio de BD', APPLICATION: 'Aplicación', PROJECT: 'Proyecto' }
</script>
