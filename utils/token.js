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

// El token lleva solo el id del usuario ("sub" = subject, el estándar dice que
// es un string). No pongas datos sensibles: el contenido de un JWT NO está
// cifrado, cualquiera lo lee en jwt.io. La firma solo garantiza que no se cambió.
export function firmarToken(userId) {
    return jwt.sign({}, secreto(), {
        subject: String(userId),
        algorithm: ALGORITMO,
        expiresIn: DURACION,
    })
}

// Devuelve el id del usuario o null si el token es inválido, está vencido
// o fue modificado (la firma no coincide).
export function verificarToken(token) {
    try {
        const payload = jwt.verify(token, secreto(), { algorithms: [ALGORITMO] })
        const id = Number(payload.sub)
        return Number.isInteger(id) && id > 0 ? id : null
    } catch {
        return null
    }
}
