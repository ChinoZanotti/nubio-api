// Cifrado de datos que no pueden quedar legibles en la base ni en un backup:
// hoy, el secreto TOTP de los operadores (panel comercial, etapa 2; revisión de
// Case, A4). Con el secreto alguien podría generar los códigos de 2 pasos.
//
// AES-256-GCM: cifra y además detecta si el texto cifrado fue alterado. La
// clave (ADMIN_CIFRADO_KEY, 32 bytes en base64) vive solo en las variables de
// Render y en la PC del desarrollador, nunca en la base ni en el repo: un
// backup robado no alcanza. Si se pierde la clave, los operadores tienen que
// volver a activar (npm run operadores -- resetear).
//
// `contexto` (dato asociado de GCM): a qué pertenece lo cifrado, por ejemplo
// "operador:5". No se guarda, pero hay que dar el mismo para descifrar: así,
// quien pueda escribir en la base no puede copiar el secreto de un operador a
// la fila de otro (revisión de Case de la etapa 2, B6).
//
// Formato guardado: "v1.<iv>.<tag>.<cifrado>" en base64url. El "v1" permite
// cambiar de clave o de algoritmo algún día sin confundir los viejos.
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto'

function clave() {
    const texto = process.env.ADMIN_CIFRADO_KEY ?? ''
    const bytes = Buffer.from(texto, 'base64')
    if (bytes.length !== 32) {
        throw new Error('ADMIN_CIFRADO_KEY no está definido o no son 32 bytes en base64 (generala con: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))").')
    }
    return bytes
}

export function configuracionCifradoOk() {
    try {
        clave()
        return true
    } catch {
        return false
    }
}

export function cifrar(texto, contexto) {
    if (!contexto) throw new Error('cifrar necesita el contexto (a qué pertenece el dato).')
    const iv = randomBytes(12)
    const cifrador = createCipheriv('aes-256-gcm', clave(), iv)
    cifrador.setAAD(Buffer.from(contexto))
    const datos = Buffer.concat([cifrador.update(String(texto), 'utf8'), cifrador.final()])
    return ['v1', iv, cifrador.getAuthTag(), datos].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.')
}

export function descifrar(guardado, contexto) {
    if (!contexto) throw new Error('descifrar necesita el contexto (a qué pertenece el dato).')
    const [version, iv, tag, datos] = String(guardado).split('.')
    if (version !== 'v1' || !iv || !tag || !datos) throw new Error('Dato cifrado con formato desconocido')
    const descifrador = createDecipheriv('aes-256-gcm', clave(), Buffer.from(iv, 'base64url'))
    descifrador.setAAD(Buffer.from(contexto))
    descifrador.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([descifrador.update(Buffer.from(datos, 'base64url')), descifrador.final()]).toString('utf8')
}

// HMAC con una clave derivada de ADMIN_CIFRADO_KEY y un rótulo propio (no la
// misma clave para dos usos). Para guardar los tokens de activación: sin la
// clave, quien escriba en la base no puede fabricar uno (Case, B6).
export function hmac(rotulo, texto) {
    const derivada = createHmac('sha256', clave()).update(`nubio:${rotulo}`).digest()
    return createHmac('sha256', derivada).update(String(texto)).digest('hex')
}
