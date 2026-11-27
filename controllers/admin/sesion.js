// Login del panel comercial (etapa 2), en dos pasos:
//   1. POST /admin/signin { email, password } -> { desafio } (vale 5 minutos)
//   2. POST /admin/signin/codigo { desafio, codigo } -> { token, operador } (1 hora)
// El token de sesión sale recién después del código de 2 pasos (revisión de
// Case, A4): con solo la contraseña no alcanza.
//
// Mismas precauciones que el login de clientes (controllers/signin.js):
// mensaje único para correo inexistente o contraseña mal, bcrypt contra un
// hash de relleno para igualar tiempos, demora por correo además del límite
// por IP. El límite por correo usa una clave propia ("operador:"), separada de
// la de clientes.
//
// Códigos incorrectos (revisión de Case de la etapa 2, A1): el intento se
// RESERVA en la base antes de comprobar el código, en una sola sentencia con
// la condición del tope. Con pedidos en paralelo, la base los hace esperar de
// a uno y pasan solo los que entran en el tope. Y no se borra con un deploy.
// - 5 incorrectos en 15 minutos: hay que esperar;
// - 20 seguidos sin un acierto: bloqueado hasta que el desarrollador lo
//   resetee (npm run operadores -- resetear).
// El desafío es de un solo uso: el código correcto lo gasta, y pedir otro
// (un login nuevo) invalida el anterior.
import { randomBytes } from 'node:crypto'
import { normalizarEmail, validarEmail } from '../../utils/authValidation.js'
import { COSTO_BCRYPT } from '../register.js'
import { esperaPendiente, registrarIntento, registrarExito, esIpConocida } from '../../utils/intentosPorCuenta.js'
import { registrarEvento } from '../../utils/eventos.js'
import { registrarError } from '../../utils/log.js'
import { firmarTokenOperador, verificarTokenOperador, AUD_DESAFIO } from '../../utils/tokenOperador.js'
import { verificarCodigo } from '../../utils/totp.js'
import { descifrar } from '../../utils/cifrado.js'
import { registrarAuditoria, ORIGEN } from '../../services/auditoria.js'
import { contextoOperador } from '../../services/operadores.js'

const INVALIDAS = { error: 'Correo o contraseña incorrectos.' }
const CODIGO_INVALIDO = { error: 'El código no es correcto. Mirá el que muestra ahora tu app y volvé a probar.' }
const DESAFIO_VENCIDO = { error: 'Pasaron más de 5 minutos. Volvé a ingresar tu correo y contraseña.' }
export const BLOQUEADO = {
    error: 'Tu acceso quedó bloqueado por muchos códigos incorrectos. Pedile a quien administra el panel que lo reactive.',
    codigo: 'operador_bloqueado',
}
const ESPERAR = { error: 'Demasiados códigos incorrectos. Esperá 15 minutos y volvé a probar.' }
const MAX_PASSWORD = 1024
export const FALLOS_POR_VENTANA = 5
export const FALLOS_HASTA_BLOQUEO = 20
const VENTANA = "interval '15 minutes'"
const claveLimite = (email) => `operador:${email}`

let hashDeRelleno = null

export async function handleAdminSignin(req, res, db, bcrypt) {
    const email = normalizarEmail(req.body?.email)
    const { password } = req.body ?? {}
    if (!email || validarEmail(email) || typeof password !== 'string' || !password || password.length > MAX_PASSWORD) {
        return res.status(400).json(INVALIDAS)
    }
    const espera = esperaPendiente(claveLimite(email), req.ip)
    if (espera > 0) {
        registrarEvento('admin_login_demorado', { email, ip: req.ip, espera })
        res.set('Retry-After', String(espera))
        return res.status(429).json({ error: `Hubo muchos intentos fallidos. Esperá ${espera} segundos y volvé a probar.` })
    }
    registrarIntento(claveLimite(email))

    try {
        const operador = await db('operadores').where({ email }).first('id', 'hash', 'activo', 'token_version', 'bloqueado_at')
        hashDeRelleno ??= await bcrypt.hash('relleno-para-igualar-tiempos', COSTO_BCRYPT)
        const valida = await bcrypt.compare(password, operador?.hash ?? hashDeRelleno)
        // Sin activar (sin hash) o desactivado: el mismo mensaje que una
        // contraseña mal. No se dice que el correo es de un operador.
        if (!operador || !operador.hash || !operador.activo || !valida) {
            registrarEvento('admin_login_fallido', { email, ip: req.ip, existe: Boolean(operador) })
            return res.status(400).json(INVALIDAS)
        }
        // Bloqueado: recién con la contraseña correcta se dice el motivo (como
        // una cuenta suspendida en el login de clientes).
        if (operador.bloqueado_at) return res.status(403).json(BLOQUEADO)

        // Desafío nuevo: reemplaza al anterior (que deja de servir)
        const desafioId = randomBytes(16).toString('base64url')
        await db('operadores').where({ id: operador.id }).update({ desafio_id: desafioId })
        // No se llama a registrarExito todavía: el login termina con el código.
        res.json({ desafio: firmarTokenOperador(operador.id, operador.token_version, AUD_DESAFIO, desafioId) })
    } catch (err) {
        registrarError('POST /admin/signin', err)
        res.status(500).json({ error: 'Error en el servidor. Probá de nuevo en unos minutos.' })
    }
}

export async function handleAdminCodigo(req, res, db) {
    const { desafio, codigo } = req.body ?? {}
    const datos = typeof desafio === 'string' && desafio.length < 2000 ? verificarTokenOperador(desafio, AUD_DESAFIO) : null
    if (!datos || !datos.desafioId) return res.status(401).json(DESAFIO_VENCIDO)

    try {
        const ventanaVencida = `(ventana_desde IS NULL OR ventana_desde < now() - ${VENTANA})`
        // Reservar el intento: solo si el desafío sigue siendo el vigente y
        // queda lugar en el tope. La base serializa los pedidos en paralelo.
        const [operador] = await db('operadores')
            .where({ id: datos.operadorId, activo: true, token_version: datos.tv, desafio_id: datos.desafioId })
            .whereNotNull('hash')
            .whereNull('bloqueado_at')
            .where('fallos_seguidos', '<', FALLOS_HASTA_BLOQUEO)
            .where((q) => q.whereRaw(ventanaVencida).orWhere('fallos_ventana', '<', FALLOS_POR_VENTANA))
            .update({
                fallos_ventana: db.raw(`CASE WHEN ${ventanaVencida} THEN 1 ELSE fallos_ventana + 1 END`),
                ventana_desde: db.raw(`CASE WHEN ${ventanaVencida} THEN now() ELSE ventana_desde END`),
                fallos_seguidos: db.raw('fallos_seguidos + 1'),
            })
            .returning(['id', 'nombre', 'email', 'token_version', 'totp_secreto', 'ultimo_paso_totp', 'fallos_seguidos'])

        if (!operador) {
            // ¿Por qué no se pudo reservar? Desafío viejo o usado, bloqueado, o tope.
            const actual = await db('operadores').where({ id: datos.operadorId })
                .first('activo', 'hash', 'token_version', 'desafio_id', 'bloqueado_at', 'fallos_seguidos')
            if (!actual || !actual.activo || !actual.hash || actual.token_version !== datos.tv || actual.desafio_id !== datos.desafioId) {
                return res.status(401).json(DESAFIO_VENCIDO)
            }
            if (actual.bloqueado_at || actual.fallos_seguidos >= FALLOS_HASTA_BLOQUEO) return res.status(403).json(BLOQUEADO)
            return res.status(429).json(ESPERAR)
        }

        const paso = verificarCodigo(descifrar(operador.totp_secreto, contextoOperador(operador.id)), codigo, {
            ultimoPaso: operador.ultimo_paso_totp === null ? null : Number(operador.ultimo_paso_totp),
        })
        // Gastar el código y el desafío, y poner los contadores en cero, en
        // una sentencia: dos pedidos con el mismo código no entran los dos.
        const aceptado = paso === null ? 0 : await db('operadores')
            .where({ id: operador.id, desafio_id: datos.desafioId })
            .where((q) => q.whereNull('ultimo_paso_totp').orWhere('ultimo_paso_totp', '<', paso))
            .update({ ultimo_paso_totp: paso, desafio_id: null, fallos_ventana: 0, ventana_desde: null, fallos_seguidos: 0 })

        if (!aceptado) {
            // Contraseña correcta y código incorrecto: puede que la contraseña
            // esté en otras manos. Queda en la auditoría (Case, M3).
            await registrarAuditoria(db, { operadorId: operador.id, origen: ORIGEN.panel, accion: 'codigo_fallido', detalle: { seguidos: operador.fallos_seguidos }, ip: req.ip })
            if (operador.fallos_seguidos >= FALLOS_HASTA_BLOQUEO) {
                await db('operadores').where({ id: operador.id }).update({ bloqueado_at: db.fn.now(), desafio_id: null })
                await registrarAuditoria(db, { operadorId: operador.id, origen: ORIGEN.panel, accion: 'bloqueo_codigo', ip: req.ip })
                return res.status(403).json(BLOQUEADO)
            }
            return res.status(400).json(CODIGO_INVALIDO)
        }

        const ipNueva = !esIpConocida(claveLimite(operador.email), req.ip)
        registrarExito(claveLimite(operador.email), req.ip)
        await registrarAuditoria(db, { operadorId: operador.id, origen: ORIGEN.panel, accion: 'login', detalle: { ipNueva }, ip: req.ip })
        res.json({
            token: firmarTokenOperador(operador.id, operador.token_version),
            operador: { id: operador.id, nombre: operador.nombre, email: operador.email },
        })
    } catch (err) {
        registrarError('POST /admin/signin/codigo', err)
        res.status(500).json({ error: 'Error en el servidor. Probá de nuevo en unos minutos.' })
    }
}

export function handleAdminMe(req, res) {
    res.json(req.operador)
}

// Cerrar sesión (Case, B1): sube token_version, así el token deja de servir
// también en el servidor, no solo se borra del navegador.
export async function handleAdminSalir(req, res, db) {
    try {
        await db.transaction(async (trx) => {
            await trx('operadores').where({ id: req.operadorId }).update({ token_version: trx.raw('token_version + 1'), desafio_id: null })
            await registrarAuditoria(trx, { operadorId: req.operadorId, origen: ORIGEN.panel, accion: 'logout', ip: req.ip })
        })
        res.status(204).end()
    } catch (err) {
        registrarError('POST /admin/salir', err)
        res.status(500).json({ error: 'No se pudo cerrar la sesión.' })
    }
}
