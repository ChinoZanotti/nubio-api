// Link de activación de los CLIENTES (panel comercial, etapa 3; tabla
// activaciones_usuario, sql/016). Con él, el cliente crea su contraseña en la
// app (/activar#t=...): el comercial que lo da de alta nunca la conoce
// (revisión de Case de la idea, A5).
//
// Mismo diseño que el de los operadores (services/operadores.js):
// - 32 bytes aleatorios; en la base un HMAC con clave derivada de
//   ADMIN_CIFRADO_KEY (rótulo propio): sin la clave no se fabrica uno;
// - un solo uso, vence a las 72 h;
// - en el fragmento de la URL: no viaja al servidor ni queda en los logs.
// Sirve también para "olvidé mi contraseña" mientras no haya correos: el
// comercial genera uno nuevo. La contraseña vieja sigue valiendo hasta que se
// use el link (generarlo por error no deja a nadie afuera).
import { randomBytes } from 'node:crypto'
import { hmac } from '../utils/cifrado.js'

export const VIGENCIA_MS = 72 * 60 * 60 * 1000
export const hashTokenUsuario = (token) => hmac('activacion-usuario', token)

function urlApp() {
    const base = (process.env.FRONTEND_URL ?? '').split(',')[0].trim().replace(/\/$/, '')
    if (!base) throw new Error('FRONTEND_URL no está definido (la dirección de la app, para armar el link).')
    return base
}

// Link nuevo para el usuario; revoca los anteriores sin usar (revocada_at, no
// usada_at: así se distingue cuál se usó y cuál se reemplazó). Dentro de la
// transacción de quien llama. Devuelve { link, vence }.
// Bloquea la fila del usuario: si dos operadores generan un link a la vez, el
// segundo espera al primero y revoca el suyo, y nunca quedan dos vigentes
// (Case, B2; además lo garantiza el índice único parcial de sql/016).
export async function crearActivacionUsuario(trx, userId, operadorId) {
    await trx('users').where({ id: userId }).forUpdate().first('id')
    await trx('activaciones_usuario').where({ user_id: userId }).whereNull('usada_at').whereNull('revocada_at')
        .update({ revocada_at: trx.fn.now() })
    const token = randomBytes(32).toString('base64url')
    const vence = new Date(Date.now() + VIGENCIA_MS)
    await trx('activaciones_usuario').insert({ user_id: userId, token_hash: hashTokenUsuario(token), vence_at: vence, creada_por: operadorId })
    return { link: `${urlApp()}/activar#t=${token}`, vence }
}

// La activación vigente de un token, con el usuario, o null.
export async function activacionUsuarioVigente(db, token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null
    return db('activaciones_usuario as a')
        .join('users as u', 'u.id', 'a.user_id')
        .where('a.token_hash', hashTokenUsuario(token))
        .whereNull('a.usada_at')
        .whereNull('a.revocada_at')
        .where('a.vence_at', '>', db.fn.now())
        .first('a.id', 'a.user_id', 'u.name', 'u.email', 'u.cuenta_id')
}
