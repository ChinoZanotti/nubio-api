// Operadores del panel comercial (etapa 2; sql/015_operadores.sql).
// Los crea, resetea y desactiva el desarrollador con scripts (npm run
// operadores); la persona se activa sola con el link.
//
// El link de activación (revisión de Case, A5 de la idea y B6/M2 de la etapa):
// - token de 32 bytes aleatorios; en la base va un HMAC con una clave derivada
//   de ADMIN_CIFRADO_KEY, nunca el token: quien pueda escribir en la base no
//   puede fabricar un link sin la clave;
// - un solo uso, vence a las 72 h;
// - va en el FRAGMENTO de la URL (#t=...), que el navegador no manda al
//   servidor: no queda en los logs de Render ni de Cloudflare. El frontend lo
//   lee y lo manda en el cuerpo de un POST;
// - cada vez que se abre queda en la auditoría con la IP (activacion_vista), y
//   `listar` avisa si se abrió desde más de un lugar (Case, M2).
// Quien tiene el link elige la contraseña y configura el código de 2 pasos:
// mandarlo solo a la persona, por un canal suyo (WhatsApp directo).
import { randomBytes } from 'node:crypto'
import { generarSecreto } from '../utils/totp.js'
import { cifrar, hmac } from '../utils/cifrado.js'
import { registrarAuditoria } from './auditoria.js'

export const VIGENCIA_ACTIVACION_MS = 72 * 60 * 60 * 1000
export const hashToken = (token) => hmac('activacion', token)
// El secreto TOTP se cifra atado a su operador (dato asociado de GCM)
export const contextoOperador = (operadorId) => `operador:${operadorId}`

function urlPanel() {
    const base = (process.env.ADMIN_FRONTEND_URL ?? '').split(',')[0].trim().replace(/\/$/, '')
    if (!base) throw new Error('ADMIN_FRONTEND_URL no está definido (la dirección del panel, para armar el link).')
    return base
}

// Crea un link nuevo para el operador e invalida los anteriores que no se
// usaron. Devuelve la URL completa. Va dentro de la transacción de quien llama.
export async function crearActivacion(trx, operadorId) {
    await trx('activaciones_operador').where({ operador_id: operadorId }).whereNull('usada_at')
        .update({ usada_at: trx.fn.now(), totp_secreto: null })
    const token = randomBytes(32).toString('base64url')
    await trx('activaciones_operador').insert({
        operador_id: operadorId,
        token_hash: hashToken(token),
        totp_secreto: cifrar(generarSecreto(), contextoOperador(operadorId)),
        vence_at: new Date(Date.now() + VIGENCIA_ACTIVACION_MS),
    })
    return `${urlPanel()}/activar#t=${token}`
}

// La activación vigente de un token, con su operador, o null. Vigente = sin
// usar, sin vencer, y el operador activo.
export async function activacionVigente(db, token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null
    return db('activaciones_operador as a')
        .join('operadores as o', 'o.id', 'a.operador_id')
        .where('a.token_hash', hashToken(token))
        .whereNull('a.usada_at')
        .where('a.vence_at', '>', db.fn.now())
        .where('o.activo', true)
        .first('a.id', 'a.operador_id', 'a.totp_secreto', 'o.nombre', 'o.email')
}

export async function crearOperador(db, { nombre, email }) {
    return db.transaction(async (trx) => {
        const [op] = await trx('operadores').insert({ nombre, email }).returning('id')
        const link = await crearActivacion(trx, op.id)
        await registrarAuditoria(trx, { origen: 'script', accion: 'operador_creado', detalle: { operador: op.id } })
        return { id: op.id, link }
    })
}

// Olvidó la contraseña, perdió el celular o quedó bloqueado por códigos
// incorrectos: se borran contraseña, segundo factor y bloqueo, se cortan sus
// sesiones y se da un link nuevo.
export async function resetearOperador(db, operadorId) {
    return db.transaction(async (trx) => {
        const cambiado = await trx('operadores').where({ id: operadorId }).update({
            hash: null, totp_secreto: null, ultimo_paso_totp: null, activado_at: null, desafio_id: null,
            fallos_ventana: 0, ventana_desde: null, fallos_seguidos: 0, bloqueado_at: null,
            token_version: trx.raw('token_version + 1'),
        })
        if (!cambiado) return null
        const link = await crearActivacion(trx, operadorId)
        await registrarAuditoria(trx, { origen: 'script', accion: 'operador_reseteado', detalle: { operador: operadorId } })
        return link
    })
}

// Deja el panel (no se borra: la auditoría sigue diciendo quién fue).
export async function desactivarOperador(db, operadorId) {
    return db.transaction(async (trx) => {
        const cambiado = await trx('operadores').where({ id: operadorId, activo: true })
            .update({ activo: false, desafio_id: null, token_version: trx.raw('token_version + 1') })
        if (!cambiado) return false
        await trx('activaciones_operador').where({ operador_id: operadorId }).whereNull('usada_at')
            .update({ usada_at: trx.fn.now(), totp_secreto: null })
        await registrarAuditoria(trx, { origen: 'script', accion: 'operador_desactivado', detalle: { operador: operadorId } })
        return true
    })
}

// Para `listar`: desde cuántas IPs distintas se abrió el link pendiente de
// cada operador (si son más de una, alguien más lo vio).
export async function ipsQueAbrieronLink(db, operadorId) {
    const pendiente = await db('activaciones_operador').where({ operador_id: operadorId }).whereNull('usada_at')
        .orderBy('id', 'desc').first('id', 'created_at')
    if (!pendiente) return null
    const { ips } = await db('auditoria_admin')
        .where({ accion: 'activacion_vista', operador_id: operadorId })
        .where('created_at', '>=', pendiente.created_at)
        .countDistinct('ip as ips').first()
    return Number(ips)
}
