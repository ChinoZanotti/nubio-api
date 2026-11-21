import jwt from 'jsonwebtoken'

// Cuánto dura una sesión. Al vencer, el usuario tiene que volver a loguearse.
// 8 horas = una jornada de trabajo: si roban el token, sirve como mucho ese tiempo.
const DURACION = '8h'

// Fijamos el algoritmo al firmar Y al verificar. Si no, una librería podría
// aceptar un token con "alg": "none" (sin firma) o con otro algoritmo que el
// atacante elija. HS256 = HMAC con SHA-256 y un secreto compartido.
const ALGORITMO = 'HS256'

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
        const userId = Number(payload.sub)
        // 'in' y no ??: un tv: null no es "falta", es un valor inválido.
        const tv = 'tv' in payload ? payload.tv : 0
        if (!Number.isInteger(userId) || userId <= 0 || !Number.isInteger(tv) || tv < 0) return null
        return { userId, tv }
    } catch {
        return null
    }
}
