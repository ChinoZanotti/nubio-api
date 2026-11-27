// Códigos de 2 pasos (TOTP, RFC 6238): los de Google Authenticator, Microsoft
// Authenticator o similares. Panel comercial, etapa 2.
//
// Cómo funciona: el operador y el servidor comparten un secreto (se lo pasa el
// QR de la activación). Cada 30 s, los dos calculan un número de 6 cifras con
// HMAC-SHA1(secreto, número de período). Si coinciden, la persona tiene el
// celular. Implementado acá (son pocas líneas, con los vectores de prueba del
// RFC en tests/totp.test.js) para no sumar una dependencia al backend.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const PERIODO_S = 30
const DIGITOS = 6
// Se acepta el código del período anterior y del siguiente: el reloj del
// celular puede estar unos segundos corrido, y la persona tarda en tipear.
const VENTANA = 1
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

// 20 bytes (160 bits), lo que recomienda el RFC para SHA-1. En base32, que es
// lo que leen las apps.
export function generarSecreto() {
    return aBase32(randomBytes(20))
}

export function aBase32(bytes) {
    let bits = ''
    for (const b of bytes) bits += b.toString(2).padStart(8, '0')
    let salida = ''
    for (let i = 0; i < bits.length; i += 5) salida += BASE32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)]
    return salida
}

function deBase32(texto) {
    const limpio = String(texto).toUpperCase().replace(/=+$/, '')
    let bits = ''
    for (const c of limpio) {
        const v = BASE32.indexOf(c)
        if (v < 0) throw new Error('Secreto TOTP inválido')
        bits += v.toString(2).padStart(5, '0')
    }
    const bytes = []
    for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
    return Buffer.from(bytes)
}

// El código de un período. `digitos` es configurable solo para los vectores
// de prueba del RFC (que usan 8).
export function codigoDelPaso(secretoBase32, paso, digitos = DIGITOS) {
    const contador = Buffer.alloc(8)
    contador.writeBigUInt64BE(BigInt(paso))
    const hmac = createHmac('sha1', deBase32(secretoBase32)).update(contador).digest()
    const desde = hmac[hmac.length - 1] & 0x0f
    const numero = (hmac.readUInt32BE(desde) & 0x7fffffff) % 10 ** digitos
    return String(numero).padStart(digitos, '0')
}

export const pasoActual = (ahora = Date.now()) => Math.floor(ahora / 1000 / PERIODO_S)

// Devuelve el paso que coincide (para guardarlo y no aceptar el mismo código
// dos veces), o null. `ultimoPaso`: el último aceptado; uno igual o anterior se
// rechaza aunque el código sea correcto (alguien que lo vio y lo repite).
export function verificarCodigo(secretoBase32, codigo, { ultimoPaso = null, ahora = Date.now() } = {}) {
    const limpio = String(codigo ?? '').replace(/\s/g, '')
    if (!/^\d{6}$/.test(limpio)) return null
    const actual = pasoActual(ahora)
    for (let d = -VENTANA; d <= VENTANA; d++) {
        const paso = actual + d
        if (ultimoPaso !== null && paso <= ultimoPaso) continue
        const esperado = codigoDelPaso(secretoBase32, paso)
        if (timingSafeEqual(Buffer.from(esperado), Buffer.from(limpio))) return paso
    }
    return null
}

// Lo que va en el QR. La etiqueta dice "Nubio Panel" y el correo, para que la
// persona lo reconozca en la app entre otros.
export function uriOtpauth(secretoBase32, email) {
    const emisor = 'Nubio Panel'
    const etiqueta = encodeURIComponent(`${emisor}:${email}`)
    return `otpauth://totp/${etiqueta}?secret=${secretoBase32}&issuer=${encodeURIComponent(emisor)}&algorithm=SHA1&digits=${DIGITOS}&period=${PERIODO_S}`
}
