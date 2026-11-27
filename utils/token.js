import jwt from 'jsonwebtoken'

// Cuánto dura una sesión. Al vencer, el usuario tiene que volver a loguearse.
// 8 horas = una jornada de trabajo: si roban el token, sirve como mucho ese tiempo.
const DURACION = '8h'

// Fijamos el algoritmo al firmar Y al verificar. Si no, una librería podría
// aceptar un token con "alg": "none" (sin firma) o con otro algoritmo que el
// atacante elija. HS256 = HMAC con SHA-256 y un secreto compartido.
const ALGORITMO = 'HS256'

// Para qué app es el token (claim "aud") y quién lo emitió ("iss"). Panel
// comercial, etapa 1 (revisión de Case, C1): el panel va a tener sus propias
// sesiones, con OTRA clave y otro "aud". Con esto, un token de una app no
// sirve en la otra aunque alguna vez compartieran la clave por error.
const AUDIENCIA = 'nubio-app'
const EMISOR = 'nubio-api'

function secreto() {
    const valor = process.env.JWT_SECRET
    if (!valor || valor.length < 32) {
        throw new Error('JWT_SECRET no está definido o es demasiado corto (mínimo 32 caracteres).')
    }
    return valor
}

// Se llama al arrancar el servidor: si falta el secreto, mejor no levantar
// que levantar y fallar recién en el primer login.
export function verificarConfiguracion() {
    secreto()
}

// El token lleva el id del usuario ("sub" = subject, el estándar dice que es
// un string) y la versión de sus sesiones ("tv", ver sql/008_token_version.sql
// y utils/versionToken.js). No pongas datos sensibles: el contenido de un JWT
// NO está cifrado, cualquiera lo lee en jwt.io. La firma solo garantiza que no
// se cambió.
export function firmarToken(userId, tokenVersion) {
    if (!Number.isInteger(tokenVersion) || tokenVersion < 0) {
        throw new Error('firmarToken necesita la token_version del usuario.')
    }
    return jwt.sign({ tv: tokenVersion }, secreto(), {
        subject: String(userId),
        audience: AUDIENCIA,
        issuer: EMISOR,
        algorithm: ALGORITMO,
        expiresIn: DURACION,
    })
}

// Devuelve { userId, tv } o null si el token es inválido, está vencido o fue
// modificado (la firma no coincide). Que la versión siga vigente lo decide
// requireAuth, que es el que consulta la base.
// Sin "tv" se lee 0: son los tokens emitidos antes de la columna, que siguen
// valiendo hasta que la persona cambie la contraseña (o venzan, 8 h).
export function verificarToken(token) {
    try {
        const payload = jwt.verify(token, secreto(), { algorithms: [ALGORITMO] })
        // Si trae aud o iss, tienen que ser los de la app de clientes. Los
        // tokens emitidos antes de este cambio no los traen y siguen valiendo
        // hasta vencer (8 h): no hacía falta cerrar todas las sesiones al
        // deployar. Pasadas esas 8 h, exigirlos (deuda en CLAUDE.md, junto con
        // la de "tv"). jwt.verify con { audience } rechazaría los viejos.
        if ('aud' in payload && payload.aud !== AUDIENCIA) return null
        if ('iss' in payload && payload.iss !== EMISOR) return null
        const userId = Number(payload.sub)
        // 'in' y no ??: un tv: null no es "falta", es un valor inválido.
        const tv = 'tv' in payload ? payload.tv : 0
        if (!Number.isInteger(userId) || userId <= 0 || !Number.isInteger(tv) || tv < 0) return null
        return { userId, tv }
    } catch {
        return null
    }
}
