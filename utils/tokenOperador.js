// Sesiones del panel comercial (etapa 2). APARTE de las de clientes
// (utils/token.js), por la revisión de Case de la idea del panel (C1):
// - Otra clave: ADMIN_JWT_SECRET, distinta de JWT_SECRET. Si un token de
//   cliente y uno de operador se firmaran con la misma, el del operador 1
//   pasaría por el usuario 1 de la app y al revés.
// - aud e iss propios, exigidos al verificar.
// - Duran 1 hora (las de clientes, 8): es la llave de todas las cuentas.
//
// Dos tipos de token:
// - desafío ('nubio-admin-2fa', 5 min): sale del primer paso del login
//   (contraseña correcta). Solo sirve para mandar el código de 2 pasos.
// - sesión ('nubio-admin', 1 h): sale del segundo paso. Es la que usa el panel.
import jwt from 'jsonwebtoken'

const ALGORITMO = 'HS256'
const EMISOR = 'nubio-api'
export const AUD_SESION = 'nubio-admin'
export const AUD_DESAFIO = 'nubio-admin-2fa'
const DURACION = { [AUD_SESION]: '1h', [AUD_DESAFIO]: '5m' }

function secreto() {
    const valor = process.env.ADMIN_JWT_SECRET ?? ''
    if (valor.length < 32) throw new Error('ADMIN_JWT_SECRET no está definido o es demasiado corto (mínimo 32 caracteres).')
    if (valor === process.env.JWT_SECRET) throw new Error('ADMIN_JWT_SECRET tiene que ser distinto de JWT_SECRET.')
    return valor
}

export function configuracionTokenOperadorOk() {
    try {
        secreto()
        return true
    } catch {
        return false
    }
}

// `desafioId`: solo para el desafío. Es de un solo uso: el servidor guarda el
// vigente en operadores.desafio_id y el código correcto lo gasta (revisión de
// Case de la etapa 2, A1). Un login nuevo lo reemplaza.
export function firmarTokenOperador(operadorId, tokenVersion, audiencia = AUD_SESION, desafioId = undefined) {
    if (!Number.isInteger(tokenVersion) || tokenVersion < 0) throw new Error('Falta la token_version del operador.')
    return jwt.sign({ tv: tokenVersion }, secreto(), {
        ...(desafioId && { jwtid: desafioId }),
        subject: String(operadorId),
        audience: audiencia,
        issuer: EMISOR,
        algorithm: ALGORITMO,
        expiresIn: DURACION[audiencia],
    })
}

// { operadorId, tv, desafioId } o null. Exige la audiencia pedida: un desafío no sirve
// como sesión ni al revés, y un token de cliente no sirve para nada acá
// (otra clave, y además no tiene esta audiencia).
export function verificarTokenOperador(token, audiencia = AUD_SESION) {
    try {
        const payload = jwt.verify(token, secreto(), { algorithms: [ALGORITMO], audience: audiencia, issuer: EMISOR })
        const operadorId = Number(payload.sub)
        const tv = payload.tv
        if (!Number.isInteger(operadorId) || operadorId <= 0 || !Number.isInteger(tv) || tv < 0) return null
        return { operadorId, tv, desafioId: payload.jti }
    } catch {
        return null
    }
}
