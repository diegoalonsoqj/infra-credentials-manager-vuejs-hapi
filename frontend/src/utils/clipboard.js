// =============================================================================
// utils/clipboard.js — Copia de secretos al portapapeles.
//
// Unifica lo que antes estaba duplicado en cuatro pantallas con tres
// comportamientos distintos: el generador de contraseñas traía respaldo para
// contextos sin HTTPS, el wizard no lo traía, y la página de credenciales
// —la que maneja secretos reales— tampoco tenía respaldo ni manejo de error,
// así que fallaba en silencio y el usuario creía tener la contraseña copiada.
//
// navigator.clipboard solo existe en contexto seguro (HTTPS o localhost). Con
// la aplicación servida por HTTP en una IP de red es undefined, de ahí el
// respaldo con execCommand.
// =============================================================================

/**
 * Copia texto al portapapeles.
 *
 * @param {string} text
 * @returns {Promise<boolean>} true si se copió; false si no se pudo. Quien
 *   llama debe usarlo para no mostrar "copiado" cuando no ha ocurrido.
 */
export async function copySecret(text) {
  if (!text) return false

  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Permiso denegado o documento sin foco: se intenta el respaldo.
    }
  }

  try {
    const el = document.createElement('textarea')
    el.value = text
    el.setAttribute('readonly', '')
    el.style.position = 'fixed'
    el.style.opacity = '0'
    document.body.appendChild(el)
    el.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(el)
    return ok
  } catch {
    return false
  }
}

/**
 * Vacía el portapapeles.
 *
 * Se usa cuando la interfaz ya ha prometido que el secreto es efímero — el
 * diálogo de descifrado con su cuenta atrás—, para que la copia no sobreviva
 * al valor que se acaba de borrar de pantalla.
 *
 * LÍMITE REAL, que conviene no olvidar: esto sobrescribe el contenido actual,
 * pero NO borra lo que el historial del portapapeles de Windows (Win+V) o su
 * sincronización en la nube ya hayan capturado. Reduce la ventana de
 * exposición; no la elimina.
 *
 * No se llama al copiar la Master Key durante la instalación ni en el
 * generador de contraseñas: ahí el usuario todavía tiene que pegar el valor en
 * algún sitio, y borrárselo por debajo sería peor que el riesgo que evita —en
 * el caso de la Master Key, perderla significa no poder descifrar nada.
 *
 * @returns {Promise<boolean>} true si se pudo vaciar.
 */
export async function clearClipboard() {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText('')
      return true
    } catch {
      // Sin permiso o sin foco: se intenta el respaldo.
    }
  }

  try {
    const el = document.createElement('textarea')
    el.value = ''
    el.style.position = 'fixed'
    el.style.opacity = '0'
    document.body.appendChild(el)
    el.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(el)
    return ok
  } catch {
    return false
  }
}

// -----------------------------------------------------------------------------
// Vaciado pendiente.
//
// Vaciar en el momento no siempre es posible, y fallaba en silencio:
//   - si la cuenta atrás vence con la pestaña en segundo plano, el navegador
//     no deja escribir en el portapapeles sin foco;
//   - al recargar o salir a otra dirección no se llega a ejecutar nada: la
//     página se descarga sin desmontar los componentes.
// En esos casos la contraseña se quedaba en el portapapeles indefinidamente.
//
// Por eso, cuando el secreto deja de estar en pantalla se deja una marca en
// sessionStorage (solo la marca, nunca el secreto) y se vacía en cuanto se
// pueda: ahora si la pestaña tiene foco, al recuperarlo, o al volver a cargar
// la aplicación en esa pestaña. Mientras la ventana del secreto sigue abierta
// no se marca nada: el usuario puede ir a pegarlo a otra aplicación y volver.
// Si la pestaña se cierra, sessionStorage desaparece con ella y no queda nada
// que hacer: es el límite de lo que un navegador permite.
// -----------------------------------------------------------------------------

const PENDING_KEY = 'icm-vaciar-portapapeles'

function isPending() {
  try { return sessionStorage.getItem(PENDING_KEY) === '1' } catch { return false }
}

async function flushPendingClear() {
  if (!isPending()) return
  if (document.visibilityState !== 'visible' || !document.hasFocus()) return
  if (await clearClipboard()) {
    try { sessionStorage.removeItem(PENDING_KEY) } catch { /* sin almacenamiento: nada que quitar */ }
  }
}

/**
 * El secreto copiado ya no está en pantalla: vaciar el portapapeles ahora o,
 * si no se puede, en cuanto la pestaña recupere el foco.
 */
export function requestClipboardClear() {
  try { sessionStorage.setItem(PENDING_KEY, '1') } catch { /* sin almacenamiento: solo el intento inmediato */ }
  return flushPendingClear()
}

/**
 * Se instala una vez al arrancar la aplicación (main.js): reintenta el vaciado
 * pendiente al recuperar el foco o la visibilidad, y al cargar la aplicación
 * (una recarga, o volver a ella en la misma pestaña).
 */
export function installClipboardGuard() {
  window.addEventListener('focus', flushPendingClear)
  document.addEventListener('visibilitychange', flushPendingClear)
  flushPendingClear()
}
