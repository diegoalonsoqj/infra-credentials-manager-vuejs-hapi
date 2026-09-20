<!--
  ResetPwdForm.vue — Formulario de reseteo de contraseña de un usuario.

  Extraído de UsersPage.vue, donde vivía como plantilla en
  string. Eso exigía el compilador de Vue en el navegador (new Function()), que
  la CSP del backend bloquea (script-src 'self', sin unsafe-eval) y dejaba la
  página en blanco en producción. Como SFC, Vite lo compila en el build.
-->
<template>
  <div>
    <CAlert v-if="error" color="danger" class="py-2 small mb-3">{{ error }}</CAlert>
    <p class="small text-medium-emphasis mb-3">
      El usuario <strong>{{ user.username }}</strong> deberá cambiar esta contraseña en su próximo login.
    </p>
    <CFormLabel class="fw-medium small">Nueva contraseña (mínimo 15 chars)</CFormLabel>
    <CFormInput type="password" v-model="pwd" placeholder="••••••••••••••••" autocomplete="new-password" />
    <PasswordGenerator :on-use="(p) => pwd = p" />
    <div class="d-flex gap-2 mt-4">
      <CButton color="secondary" variant="outline" @click="$emit('cancel')" :disabled="loading">Cancelar</CButton>
      <CButton color="warning" class="ms-auto" @click="$emit('save', pwd)" :disabled="loading || pwd.length < 15">
        <CSpinner v-if="loading" size="sm" class="me-2" />
        {{ loading ? 'Reseteando...' : 'Resetear contraseña' }}
      </CButton>
    </div>
  </div>
</template>

<script>
import { ref, defineComponent } from 'vue'
import PasswordGenerator from '../PasswordGenerator.vue'

export default defineComponent({
  name: 'ResetPwdForm',
  components: { PasswordGenerator },
  props: {
    user:    { type: Object,  required: true },
    loading: { type: Boolean, default: false },
    error:   { type: String,  default: null },
  },
  emits: ['save', 'cancel'],
  setup() {
    const pwd = ref('')
    return { pwd }
  },
})
</script>
