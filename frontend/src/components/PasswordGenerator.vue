<template>
  <CButton
    color="secondary" variant="ghost" size="sm" type="button"
    @click="open = true"
    :style="{ fontSize: '12px', padding: '2px 8px', marginTop: '4px' }"
  >
    <Dices :size="15" class="me-1" /> Generar contraseña
  </CButton>

  <CModal :visible="open" @close="open = false" alignment="center">
    <CModalHeader>
      <CModalTitle :style="{ fontSize: '15px' }">
        <Dices :size="16" class="me-2" /> Generador de contraseña
      </CModalTitle>
    </CModalHeader>

    <CModalBody>
      <div class="d-flex flex-wrap gap-3 mb-3">
        <CFormCheck id="pg-upper" label="A–Z (mayúsculas)"
          :model-value="opts.uppercase"
          @change="opts.uppercase = $event.target.checked; regen()" />
        <CFormCheck id="pg-lower" label="a–z (minúsculas)"
          :model-value="opts.lowercase"
          @change="opts.lowercase = $event.target.checked; regen()" />
        <CFormCheck id="pg-nums" :label="`0–9 · mín. ${MIN_NUMBERS}`"
          :model-value="opts.numbers"
          @change="opts.numbers = $event.target.checked; regen()" />
        <CFormCheck id="pg-spec" :label="`!@# · mín. ${MIN_SPECIALS}`"
          :model-value="opts.specials"
          @change="opts.specials = $event.target.checked; regen()" />
      </div>

      <div class="d-flex align-items-center gap-2 mb-3">
        <CFormLabel class="mb-0 small fw-semibold">Longitud:</CFormLabel>
        <CFormInput
          type="number" size="sm" :min="MIN_LENGTH" :max="64"
          :model-value="opts.length"
          @change="setLen($event)"
          style="width: 70px"
        />
        <span class="text-medium-emphasis small">(mín. {{ MIN_LENGTH }})</span>
      </div>

      <CFormLabel class="small fw-semibold">Contraseña generada</CFormLabel>
      <CInputGroup>
        <CFormInput
          :value="pwd"
          readonly
          style="font-family: monospace; font-size: 15px; letter-spacing: 1.5px"
        />
        <CButton color="secondary" variant="outline" type="button" @click="regen" title="Regenerar">
          <RefreshCw :size="14" />
        </CButton>
        <CButton
          :color="copied ? 'success' : 'secondary'" variant="outline"
          type="button" @click="handleCopy"
        >
          <template v-if="copied"><Check :size="14" class="me-1" />Copiada</template>
          <template v-else><ClipboardCopy :size="14" class="me-1" />Copiar</template>
        </CButton>
      </CInputGroup>

      <p class="text-medium-emphasis small mt-2 mb-0">
        Mín. {{ MIN_LENGTH }} chars
        <template v-if="opts.specials">, {{ MIN_SPECIALS }} especiales</template>
        <template v-if="opts.numbers">, {{ MIN_NUMBERS }} números</template>.
        Generado con <code>crypto.getRandomValues</code>.
      </p>
    </CModalBody>

    <CModalFooter>
      <CButton color="secondary" variant="outline" type="button" @click="open = false">
        Cancelar
      </CButton>
      <CButton color="primary" type="button" @click="handleUse" :disabled="!pwd">
        Usar contraseña
      </CButton>
    </CModalFooter>
  </CModal>
</template>

<script setup>
import { ref, reactive, watch } from 'vue'
import { Dices, RefreshCw, ClipboardCopy, Check } from 'lucide-vue-next'
import { copySecret } from '../utils/clipboard.js'

const props = defineProps({
  onUse: { type: Function, required: true },
})

const UPPER   = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const LOWER   = 'abcdefghjkmnpqrstuvwxyz'
const DIGITS  = '23456789'
const SYMBOLS = '!@#$%^&*()-_=+[]{}|;:,.<>?'

const MIN_LENGTH   = 15
const MIN_SPECIALS = 3
const MIN_NUMBERS  = 2

function cryptoRand(max) {
  const arr = new Uint32Array(1)
  crypto.getRandomValues(arr)
  return arr[0] % max
}

function generatePassword({ uppercase, lowercase, numbers, specials, length }) {
  let pool = ''
  const mandatory = []

  if (uppercase) pool += UPPER
  if (lowercase) pool += LOWER
  if (numbers) {
    pool += DIGITS
    for (let i = 0; i < MIN_NUMBERS; i++)
      mandatory.push(DIGITS[cryptoRand(DIGITS.length)])
  }
  if (specials) {
    pool += SYMBOLS
    for (let i = 0; i < MIN_SPECIALS; i++)
      mandatory.push(SYMBOLS[cryptoRand(SYMBOLS.length)])
  }

  if (!pool) pool = UPPER + LOWER

  const remaining = Math.max(0, length - mandatory.length)
  const chars = [...mandatory]
  for (let i = 0; i < remaining; i++)
    chars.push(pool[cryptoRand(pool.length)])

  for (let i = chars.length - 1; i > 0; i--) {
    const j = cryptoRand(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]]
  }

  return chars.join('')
}

const open   = ref(false)
const copied = ref(false)
const pwd    = ref('')
const opts   = reactive({
  uppercase: true,
  lowercase: true,
  numbers:   true,
  specials:  true,
  length:    16,
})

function regen() {
  pwd.value = generatePassword(opts)
  copied.value = false
}

// Regenerar al abrir
watch(open, (val) => {
  if (val) regen()
})

function setLen(e) {
  const v = Math.max(MIN_LENGTH, parseInt(e.target.value, 10) || MIN_LENGTH)
  opts.length = v
  regen()
}

async function handleCopy() {
  if (!pwd.value) return
  if (!await copySecret(pwd.value)) return
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}

function handleUse() {
  props.onUse(pwd.value)
  open.value = false
}
</script>
