<!--
  CustodyImpactWarning.vue — Aviso de credenciales custodiadas que quedarían
  sin nadie capaz de descifrarlas.

  Lo muestran la ventana de permisos de un rol (al quitar CRED_REVEAL) y la de
  edición de un equipo (al quitar un tipo de recurso) cuando el backend responde
  409 CUSTODY_IMPACT. El cambio no se ha guardado: la ventana ofrece repetirlo
  con confirmCustodyImpact.
-->
<template>
  <CAlert v-if="impact && impact.length" color="danger" class="py-2 small mb-3">
    <strong>
      {{ impact.length }} credencial(es) custodiada(s) quedarían sin nadie que pueda descifrarlas.
    </strong>
    <div class="mt-1">
      Solo su custodio puede abrirlas, y con este cambio dejaría de poder hacerlo. Seguirán así hasta
      que un administrador las reasigne a otro custodio.
    </div>
    <ul class="mb-1 mt-2 ps-3" style="max-height: 180px; overflow-y: auto">
      <li v-for="c in impact" :key="c.credentialId">
        <span class="font-monospace">{{ c.credential }}</span>
        — custodio <strong>{{ c.custodian }}</strong>{{ ' ' }}<span class="text-medium-emphasis">({{ c.reason }})</span>
      </li>
    </ul>
    <div>El cambio <strong>no se ha guardado</strong>. Pulsa «Guardar de todos modos» para aplicarlo.</div>
  </CAlert>
</template>

<script setup>
defineProps({
  impact: { type: Array, default: null },
})
</script>
