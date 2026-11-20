import { createHash } from 'node:crypto'

// Límite de intentos de login POR CUENTA (por email), además del límite por IP.
//
// Por qué: el límite por IP (middleware/rateLimit.js) no frena a quien reparte
// los intentos entre muchas IPs (una botnet, proxies) contra UNA cuenta.
//
// Cómo:
// - Por cada email se cuentan los intentos fallidos de la última hora (de
//   cualquier IP). Los primeros FALLOS_LIBRES no tienen freno.
// - Desde ahí, entre intento e intento hay que esperar 1 s, 2 s, 4 s... (se
//   duplica) con techo de ESPERA_MAXIMA_S. Intentar antes da 429.
// - Un login correcto borra el contador.
// - Se cuentan también los emails que NO existen, con el mismo mensaje: si no,
//   el 429 revelaría qué cuentas existen.
//
// IPs conocidas (tercera revisión de Case, M2): la demora sola le permitía a un
// atacante tener a la víctima SIEMPRE esperando (le alcanzaba un intento por
// minuto). Por eso, desde una IP donde ese email ya inició sesión en los
// últimos 30 días, no hay demora: la víctima entra desde su oficina o su casa
// aunque la estén atacando. Desde esas IPs sigue valiendo el límite por IP.
//
// Memoria (tercera revisión, A1): las claves son el SHA-256 del email (o de
// email+IP), de largo fijo. Antes se guardaba el email tal cual llegaba y un
// "email" de 1 MB ocupaba 1 MB por entrada. Así, además, no quedan emails en
// memoria. Las entradas vencidas se barren cada 10 minutos.
//
// Vive en memoria (como el resto del rate limiting): se reinicia con el
// servidor y alcanza con una sola instancia.

const VENTANA_MS = 60 * 60 * 1000
const VIGENCIA_IP_CONOCIDA_MS = 30 * 24 * 60 * 60 * 1000
export const FALLOS_LIBRES = 10
export const ESPERA_MAXIMA_S = 60
// Tope de entradas en cada tabla: al pasarlo se descartan las más viejas (un
// Map recuerda el orden en que se insertaron las claves).
const MAX_ENTRADAS = 50_000
const BARRIDO_MS = 10 * 60 * 1000

const fallos = new Map() // hash(email) -> { cantidad, ultimo (ms) }
const ipsConocidas = new Map() // hash(email|ip) -> último login correcto (ms)

const clave = (...partes) => createHash('sha256').update(partes.join('|')).digest('base64')

// Guarda moviendo la clave al final (los primeros del Map son los más viejos)
// y respetando el tope.
function guardar(mapa, k, valor) {
    mapa.delete(k)
    mapa.set(k, valor)
    if (mapa.size > MAX_ENTRADAS) mapa.delete(mapa.keys().next().value)
}

// `ahora` se puede pasar en los tests para no depender del reloj real.
function fallosVigentes(k, ahora) {
    const registro = fallos.get(k)
    if (!registro) return null
    if (ahora - registro.ultimo > VENTANA_MS) {
        fallos.delete(k)
        return null
    }
    return registro
}

export function esIpConocida(email, ip, ahora = Date.now()) {
    if (!ip) return false
    const ultimo = ipsConocidas.get(clave(email, ip))
    return ultimo !== undefined && ahora - ultimo <= VIGENCIA_IP_CONOCIDA_MS
}

// Segundos que todavía hay que esperar para intentar con este email desde esta
// IP (0 = puede).
export function esperaPendiente(email, ip, ahora = Date.now()) {
    if (esIpConocida(email, ip, ahora)) return 0
    const registro = fallosVigentes(clave(email), ahora)
    if (!registro || registro.cantidad < FALLOS_LIBRES) return 0
    const exponente = registro.cantidad - FALLOS_LIBRES
    const esperaMs = Math.min(2 ** exponente, ESPERA_MAXIMA_S) * 1000
    const restante = registro.ultimo + esperaMs - ahora
    return restante > 0 ? Math.ceil(restante / 1000) : 0
}

// Se llama ANTES de comparar la contraseña (tercera revisión, M3): reserva el
// intento como si fuera fallido. Si después sale bien, registrarExito lo borra.
// Antes se registraba después de bcrypt (~500 ms) y los pedidos que llegaban
// en paralelo pasaban TODOS el chequeo. Esto es síncrono: no hay carrera.
export function registrarIntento(email, ahora = Date.now()) {
    const k = clave(email)
    const registro = fallosVigentes(k, ahora) ?? { cantidad: 0, ultimo: ahora }
    registro.cantidad += 1
    registro.ultimo = ahora
    guardar(fallos, k, registro)
}

// Login correcto: borra los fallos y recuerda la IP como conocida para ese email.
export function registrarExito(email, ip, ahora = Date.now()) {
    fallos.delete(clave(email))
    if (ip) guardar(ipsConocidas, clave(email, ip), ahora)
}

// Borra lo vencido. Sin esto, cada email inventado quedaría en memoria hasta
// que lo desalojara el tope.
export function barrerVencidos(ahora = Date.now()) {
    for (const [k, registro] of fallos) if (ahora - registro.ultimo > VENTANA_MS) fallos.delete(k)
    for (const [k, ultimo] of ipsConocidas) if (ahora - ultimo > VIGENCIA_IP_CONOCIDA_MS) ipsConocidas.delete(k)
}

// .unref(): el reloj no mantiene vivo el proceso (los tests y scripts terminan
// aunque esté programado).
setInterval(barrerVencidos, BARRIDO_MS).unref()

// Solo para los tests.
export function reiniciarIntentos() {
    fallos.clear()
    ipsConocidas.clear()
}

export const tamanos = () => ({ fallos: fallos.size, ipsConocidas: ipsConocidas.size })
