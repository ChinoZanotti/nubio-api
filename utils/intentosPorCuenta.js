// Límite de intentos de login POR CUENTA (por email), además del límite por IP.
//
// Por qué: el límite por IP (middleware/rateLimit.js) no frena a quien reparte
// los intentos entre muchas IPs (una botnet, proxies) contra UNA cuenta.
//
// Por qué demora y no bloqueo: si bloqueáramos la cuenta tras X fallos,
// cualquiera podría dejar afuera a la víctima a propósito, solo fallando con
// su email. Con demora, el atacante queda limitado y la víctima espera poco.
//
// Cómo:
// - Por cada email se cuentan los fallos de la última hora (de cualquier IP).
// - Los primeros FALLOS_LIBRES no tienen freno: un usuario que se equivoca no
//   lo nota.
// - Desde ahí, entre intento e intento hay que esperar 1 s, 2 s, 4 s... (se
//   duplica con cada fallo) con techo de ESPERA_MAXIMA_S. Intentar antes da 429.
//   Resultado: como mucho ~60 intentos por hora contra una cuenta, y la víctima
//   nunca espera más de un minuto.
// - Un login correcto borra el contador.
// - Se cuentan también los emails que NO existen, con el mismo mensaje: si no,
//   el 429 revelaría qué cuentas existen.
//
// Vive en memoria (como el resto del rate limiting): se reinicia con el
// servidor y alcanza con una sola instancia.

const VENTANA_MS = 60 * 60 * 1000
export const FALLOS_LIBRES = 10
export const ESPERA_MAXIMA_S = 60
// Tope de emails recordados: sin él, alguien podría llenar la memoria probando
// millones de emails inventados. Al pasarlo se descartan los más viejos (un Map
// recuerda el orden en que se insertaron las claves).
const MAX_CUENTAS = 50_000

const fallos = new Map() // email -> { cantidad, ultimo (ms) }

// `ahora` se puede pasar en los tests para no depender del reloj real.
function vigente(email, ahora) {
    const registro = fallos.get(email)
    if (!registro) return null
    if (ahora - registro.ultimo > VENTANA_MS) {
        fallos.delete(email)
        return null
    }
    return registro
}

// Segundos que todavía hay que esperar para intentar con este email (0 = puede).
export function esperaPendiente(email, ahora = Date.now()) {
    const registro = vigente(email, ahora)
    if (!registro || registro.cantidad < FALLOS_LIBRES) return 0
    const exponente = registro.cantidad - FALLOS_LIBRES
    const esperaMs = Math.min(2 ** exponente, ESPERA_MAXIMA_S) * 1000
    const restante = registro.ultimo + esperaMs - ahora
    return restante > 0 ? Math.ceil(restante / 1000) : 0
}

export function registrarFallo(email, ahora = Date.now()) {
    const registro = vigente(email, ahora) ?? { cantidad: 0, ultimo: ahora }
    registro.cantidad += 1
    registro.ultimo = ahora
    // delete + set lo manda al final: así los primeros del Map son los más viejos.
    fallos.delete(email)
    fallos.set(email, registro)
    if (fallos.size > MAX_CUENTAS) fallos.delete(fallos.keys().next().value)
}

export function registrarExito(email) {
    fallos.delete(email)
}

// Solo para los tests.
export function reiniciarIntentos() {
    fallos.clear()
}
