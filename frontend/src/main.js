import { createApp } from 'vue'
import { createPinia } from 'pinia'
import CoreuiVue from '@coreui/vue'
import CIcon from '@coreui/icons-vue'
import '@coreui/coreui/dist/css/coreui.min.css'
import './index.css'
import App from './App.vue'
import router from './router/index.js'
import { installClipboardGuard } from './utils/clipboard.js'

// Vacía el portapapeles si quedó pendiente un secreto copiado.
installClipboardGuard()

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(CoreuiVue)
app.component('CIcon', CIcon)

app.mount('#root')
