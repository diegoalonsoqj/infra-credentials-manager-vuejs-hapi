<template>
  <div style="height: 100%; overflow-y: auto">
    <CContainer style="max-width: 740px; padding-top: 24px; padding-bottom: 40px">

      <!-- Config card -->
      <CCard class="mb-3 shadow-sm">
        <CCardBody class="p-4">
          <!-- Mode selector -->
          <div class="d-flex gap-4 mb-4">
            <label v-for="m in ['password', 'passphrase']" :key="m"
              class="d-flex align-items-center gap-2" style="cursor: pointer">
              <input type="radio" :checked="mode === m" @change="switchMode(m)"
                style="width: 16px; height: 16px" />
              <span :style="{ fontSize: '14px', fontWeight: mode === m ? 600 : 400 }">
                {{ m === 'password' ? 'Contraseña' : 'Passphrase' }}
              </span>
            </label>
          </div>

          <CRow v-if="mode === 'password'" class="g-3">
            <CCol :md="12">
              <div class="d-flex justify-content-between align-items-center mb-1">
                <span class="text-medium-emphasis" style="font-size: 13px">Caracteres:</span>
                <span class="fw-bold" style="font-size: 15px">{{ pwdOpts.length }}</span>
              </div>
              <CFormRange :min="8" :max="128" :step="1" :value="pwdOpts.length"
                @input="updatePwdOpt('length', parseInt($event.target.value))" />
            </CCol>
            <CCol :md="12">
              <div class="d-flex flex-wrap gap-3">
                <label v-for="item in pwdCheckboxes" :key="item.key"
                  :title="item.title"
                  class="d-flex align-items-center gap-2" style="cursor: pointer">
                  <input type="checkbox" :checked="pwdOpts[item.key]"
                    @change="updatePwdOpt(item.key, $event.target.checked)"
                    style="width: 15px; height: 15px" />
                  <span style="font-size: 13px">{{ item.label }}</span>
                </label>
              </div>
              <p v-if="noCharset" class="text-danger mb-0" style="font-size: 12px; margin-top: 6px">
                Selecciona al menos un tipo de carácter.
              </p>
            </CCol>
          </CRow>

          <CRow v-else class="g-3">
            <CCol :md="12">
              <div class="d-flex justify-content-between align-items-center mb-1">
                <span class="text-medium-emphasis" style="font-size: 13px">Palabras:</span>
                <span class="fw-bold" style="font-size: 15px">{{ ppOpts.wordCount }}</span>
              </div>
              <CFormRange :min="3" :max="8" :step="1" :value="ppOpts.wordCount"
                @input="updatePpOpt('wordCount', parseInt($event.target.value))" />
            </CCol>
            <CCol :md="12">
              <div class="d-flex flex-wrap gap-3 align-items-center">
                <div class="d-flex align-items-center gap-2">
                  <span class="text-medium-emphasis" style="font-size: 13px">Separador:</span>
                  <select :value="ppOpts.separator"
                    @change="updatePpOpt('separator', $event.target.value)"
                    class="form-select form-select-sm" style="width: auto; font-size: 13px">
                    <option v-for="s in SEPARATORS" :key="s.value" :value="s.value">{{ s.label }}</option>
                  </select>
                </div>
                <label v-for="item in ppCheckboxes" :key="item.key"
                  class="d-flex align-items-center gap-2" style="cursor: pointer">
                  <input type="checkbox" :checked="ppOpts[item.key]"
                    @change="updatePpOpt(item.key, $event.target.checked)"
                    style="width: 15px; height: 15px" />
                  <span style="font-size: 13px">{{ item.label }}</span>
                </label>
              </div>
            </CCol>
          </CRow>
        </CCardBody>
      </CCard>

      <!-- Result card -->
      <CCard class="mb-3 shadow-sm">
        <CCardBody class="p-4 text-center">
          <!-- Password display -->
          <div style="position: relative; margin-bottom: 20px">
            <div :style="{
              fontFamily: 'monospace',
              fontSize: result.length > 30 ? '18px' : '26px',
              fontWeight: 700,
              letterSpacing: '2px',
              wordBreak: 'break-all',
              minHeight: '48px',
              lineHeight: 1.4,
              color: 'var(--cui-primary)',
            }">
              <span v-if="!result" class="text-medium-emphasis">—</span>
              <template v-else>{{ showPwd ? result : '•'.repeat(result.length) }}</template>
            </div>
            <button v-if="result" type="button"
              @click="showPwd = !showPwd"
              :title="showPwd ? 'Ocultar' : 'Mostrar'"
              style="position: absolute; top: 0; right: 0; background: none; border: none; cursor: pointer; color: var(--cui-secondary-color); padding: 4px">
              <EyeOff v-if="showPwd" :size="18" />
              <Eye v-else :size="18" />
            </button>
          </div>

          <!-- Strength bar -->
          <template v-if="result">
            <div style="height: 6px; background: var(--cui-secondary-bg); border-radius: 3px; overflow: hidden; margin-bottom: 10px">
              <div :style="{
                height: '100%',
                width: strength.pct + '%',
                background: strength.color,
                borderRadius: '3px',
                transition: 'width 0.4s, background 0.4s',
              }" />
            </div>
            <div class="d-flex justify-content-center align-items-center gap-3 flex-wrap" style="font-size: 13px">
              <span class="text-medium-emphasis">
                Fortaleza: <span :style="{ color: strength.color, fontWeight: 600 }">{{ strength.label }}</span>
              </span>
              <span class="text-medium-emphasis">
                Tiempo estimado: <span class="fw-semibold">{{ crack }}</span>
              </span>
              <CBadge color="secondary" shape="rounded-pill" style="font-size: 12px">{{ entropy }} bits</CBadge>
            </div>
          </template>
        </CCardBody>
      </CCard>

      <!-- Action buttons -->
      <div class="d-flex gap-3 justify-content-center mb-2">
        <CButton :color="copied ? 'success' : 'primary'" @click="handleCopy" :disabled="!result"
          style="border-radius: 24px; padding: 10px 28px; font-weight: 600; font-size: 14px; min-width: 160px">
          <template v-if="copied"><Check :size="14" class="me-1" />Copiada</template>
          <template v-else><ClipboardCopy :size="14" class="me-1" />Copiar contraseña</template>
        </CButton>
        <CButton color="secondary" variant="outline" @click="doGenerate()"
          style="border-radius: 24px; padding: 10px 28px; font-weight: 600; font-size: 14px; min-width: 160px">
          <RefreshCw :size="14" class="me-1" /> Regenerar
        </CButton>
      </div>

    </CContainer>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { Check, ClipboardCopy, Eye, EyeOff, RefreshCw } from 'lucide-vue-next'
import { copySecret } from '../../utils/clipboard.js'

const WORDS = [
  'apple','bridge','castle','delta','eagle','flame','globe','horse','island','jungle',
  'knife','lemon','maple','night','ocean','piano','queen','river','stone','tiger',
  'ultra','valve','wheat','xenon','yacht','zebra','amber','blaze','crisp','dense',
  'ember','frost','grace','haven','ivory','jewel','karma','lunar','magic','noble',
  'orbit','pearl','quiet','radar','solar','thorn','unity','vapor','winds','xenon',
  'yield','zones','acorn','bison','cedar','drift','elbow','finch','grove','hatch',
  'ingot','joust','kneel','lance','marsh','nexus','onion','prism','quill','raven',
  'scone','trout','untie','vivid','waltz','boxer','cello','disco','evoke','foxes',
  'grail','heron','inbox','joker','kiosk','latch','moose','nymph','olive','plumb',
  'quark','rhino','skunk','talon','umbra','viper','woken','xylem','yearn','zonal',
  'adobe','brisk','cloak','dwarf','exile','flint','graze','humid','irony','jumpy',
  'kinky','lipid','mercy','nippy','oxide','pixel','quirk','remix','siren','toxin',
  'udder','venom','walrus','xylo','yeoman','zippy','abbot','boxer','crumb','depot',
  'elfin','ferry','ghoul','hyena','imply','jerky','knack','lyric','melon','nudge',
  'optic','poker','quirk','rocky','swamp','tempo','using','voila','witch','extra',
  'yodel','zonal','acrid','brawl','cleft','duchy','epoxy','finch','guava','hoist',
  'icing','joust','knelt','lusty','monks','notch','opium','plaid','quota','risky',
  'scalp','toxic','ulcer','vault','waltz','xeric','yucca','zesty',
]

const CHARS = {
  upper:    'ABCDEFGHJKLMNPQRSTUVWXYZ',
  upperAll: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lower:    'abcdefghjkmnpqrstuvwxyz',
  lowerAll: 'abcdefghijklmnopqrstuvwxyz',
  digits:   '23456789',
  digitsAll:'0123456789',
  symbols:  '!@#$%^&*()-_=+[]{}|;:,.<>?',
}

const SEPARATORS = [
  { value: '-', label: 'Guion  ( - )' },
  { value: '_', label: 'Guion bajo ( _ )' },
  { value: '.', label: 'Punto  ( . )' },
  { value: ' ', label: 'Espacio' },
  { value: '#', label: 'Hash  ( # )' },
]

const pwdCheckboxes = [
  { key: 'upper',       label: 'A–Z' },
  { key: 'lower',       label: 'a–z' },
  { key: 'digits',      label: '0–9' },
  { key: 'symbols',     label: '!@#$%^&*' },
  { key: 'noAmbiguous', label: 'Sin ambiguos', title: 'Excluye 0, O, 1, l, I' },
]

const ppCheckboxes = [
  { key: 'capitalize', label: 'Capitalizar' },
  { key: 'addNumber',  label: 'Agregar número' },
]

function buildCharset({ upper, lower, digits, symbols, noAmbiguous }) {
  let s = ''
  if (upper)   s += noAmbiguous ? CHARS.upper    : CHARS.upperAll
  if (lower)   s += noAmbiguous ? CHARS.lower    : CHARS.lowerAll
  if (digits)  s += noAmbiguous ? CHARS.digits   : CHARS.digitsAll
  if (symbols) s += CHARS.symbols
  return s
}

function cryptoRand(max) {
  const arr = new Uint32Array(1)
  crypto.getRandomValues(arr)
  return arr[0] % max
}

function generatePassword(length, charset) {
  if (!charset) return ''
  return Array.from({ length }, () => charset[cryptoRand(charset.length)]).join('')
}

function generatePassphrase(wordCount, separator, capitalize, addNumber) {
  const words = Array.from({ length: wordCount }, () => {
    const w = WORDS[cryptoRand(WORDS.length)]
    return capitalize ? w.charAt(0).toUpperCase() + w.slice(1) : w
  })
  if (addNumber) words.push(String(cryptoRand(90) + 10))
  return words.join(separator)
}

function calcEntropy(m, opts) {
  if (m === 'passphrase') {
    const count = opts.wordCount + (opts.addNumber ? 1 : 0)
    return Math.round(count * Math.log2(WORDS.length))
  }
  const charset = buildCharset(opts)
  if (!charset) return 0
  return Math.round(opts.length * Math.log2(charset.length))
}

const CRACK_SPEEDS = 1e10
function crackTime(bits) {
  const seconds = Math.pow(2, bits) / CRACK_SPEEDS
  if (seconds < 1)        return 'Instantáneo'
  if (seconds < 60)       return 'Segundos'
  if (seconds < 3600)     return 'Minutos'
  if (seconds < 86400)    return 'Horas'
  if (seconds < 2592000)  return 'Días'
  if (seconds < 31536000) return 'Meses'
  if (seconds < 3.15e9)   return 'Años'
  if (seconds < 3.15e11)  return 'Décadas'
  if (seconds < 3.15e13)  return 'Siglos'
  return 'Milenios'
}

function strengthFromEntropy(bits) {
  if (bits < 30) return { label: 'Muy débil',  color: '#e55353', pct: 10 }
  if (bits < 50) return { label: 'Débil',      color: '#f9b115', pct: 30 }
  if (bits < 70) return { label: 'Moderada',   color: '#3399ff', pct: 55 }
  if (bits < 90) return { label: 'Fuerte',     color: '#2eb85c', pct: 78 }
  return              { label: 'Muy fuerte', color: '#00d4aa', pct: 100 }
}

const mode    = ref('password')
const pwdOpts = reactive({ length: 20, upper: true, lower: true, digits: true, symbols: false, noAmbiguous: true })
const ppOpts  = reactive({ wordCount: 4, separator: '-', capitalize: true, addNumber: true })
const result  = ref('')
const copied  = ref(false)
const noCharset = ref(false)
const showPwd = ref(false)

const entropy  = computed(() => calcEntropy(mode.value, mode.value === 'password' ? pwdOpts : ppOpts))
const strength = computed(() => strengthFromEntropy(entropy.value))
const crack    = computed(() => crackTime(entropy.value))

function doGenerate() {
  if (mode.value === 'password') {
    const charset = buildCharset(pwdOpts)
    if (!charset) { noCharset.value = true; result.value = ''; return }
    noCharset.value = false
    result.value = generatePassword(pwdOpts.length, charset)
  } else {
    noCharset.value = false
    result.value = generatePassphrase(ppOpts.wordCount, ppOpts.separator, ppOpts.capitalize, ppOpts.addNumber)
  }
  copied.value = false
  showPwd.value = false
}

function switchMode(m) {
  mode.value = m
  doGenerate()
}

function updatePwdOpt(key, val) {
  pwdOpts[key] = val
  doGenerate()
}

function updatePpOpt(key, val) {
  ppOpts[key] = val
  doGenerate()
}

async function handleCopy() {
  if (!result.value) return
  if (!await copySecret(result.value)) return
  copied.value = true
  setTimeout(() => { copied.value = false }, 2500)
}

onMounted(doGenerate)
</script>
