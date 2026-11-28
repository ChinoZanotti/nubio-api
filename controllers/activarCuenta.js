// Activación de un CLIENTE (panel comercial, etapa 3): las dos rutas públicas
// del link que genera el comercial al dar de alta la cuenta (o cuando el
// cliente olvidó la contraseña).
//   POST /activar-cuenta/ver { token } -> { nombre, email }
//   POST /activar-cuenta { token, password } -> { ok }
//       Crea o reemplaza la contraseña, gasta el link y cierra las sesiones
//       que hubiera (si es un "olvidé mi contraseña", las de quien la tenía).
// Con un link que no sirve, siempre el mismo mensaje.
// Cada vez que se abre un link queda en la auditoría con la IP
// (activacion_cliente_vista), como los de operadores: la ficha avisa si se
// abrió desde más de un lugar (Case, B4).
// RIESGO ACEPTADO (Case, A1 de la etapa 3; decisión de Carlos, noviembre 2026):
// con "Generar link" un operador podría cambiar la contraseña de un cliente ya
// activado y entrar a su cuenta. Queda el rastro (link_generado con su IP,
// activacion_cliente_vista y cliente_cambio_password con la de quien lo usó),
// pero nada lo frena. Se cierra con los correos: el link de "olvidé mi
// contraseña" irá al correo del cliente y nunca pasará por el panel.
// Misma política de contraseñas que el registro (validarPassword +
// revisarFiltrada); después la persona entra por el login de siempre.
import { validarPassword } from '../utils/authValidation.js'
import { revisarFiltrada, MENSAJE_FILTRADA } from '../utils/passwordFiltrada.js'
import { COSTO_BCRYPT } from './register.js'
import { activacionUsuarioVigente } from '../services/activacionUsuario.js'
import { recordar } from '../utils/versionToken.js'
import { registrarError } from '../utils/log.js'
import { registrarEvento } from '../utils/eventos.js'
import { registrarAuditoria, ORIGEN } from '../services/auditoria.js'

export const LINK_INVALIDO = {
    error: 'Este link ya no sirve: venció o ya se usó. Pedí uno nuevo por WhatsApp.',
    codigo: 'link_invalido',
}

export async function handleVerActivacionCuenta(req, res, db) {
    try {
        const activacion = await activacionUsuarioVigente(db, req.body?.token)
        if (!activacion) {
            registrarEvento('activacion_cuenta_invalida', { ip: req.ip })
            return res.status(400).json(LINK_INVALIDO)
        }
        await registrarAuditoria(db, { origen: ORIGEN.panel, accion: 'activacion_cliente_vista', cuentaId: activacion.cuenta_id, detalle: { activacion: activacion.id }, ip: req.ip })
        res.json({ nombre: activacion.name, email: activacion.email })
    } catch (err) {
        registrarError('POST /activar-cuenta/ver', err)
        res.status(500).json({ error: 'Error en el servidor. Probá de nuevo en unos minutos.' })
    }
}

export async function handleActivarCuenta(req, res, db, bcrypt) {
    const { token, password } = req.body ?? {}
    try {
        const activacion = await activacionUsuarioVigente(db, token)
        if (!activacion) {
            registrarEvento('activacion_cuenta_invalida', { ip: req.ip })
            return res.status(400).json(LINK_INVALIDO)
        }
        const errorPassword = typeof password === 'string'
            ? validarPassword(password, { email: activacion.email, name: activacion.name })
            : 'Elegí una contraseña.'
        if (errorPassword) return res.status(400).json({ error: errorPassword, errores: { password: errorPassword } })
        const { filtrada } = await revisarFiltrada(password)
        if (filtrada) return res.status(400).json({ error: MENSAJE_FILTRADA, errores: { password: MENSAJE_FILTRADA } })

        const hash = await bcrypt.hash(password, COSTO_BCRYPT)
        const version = await db.transaction(async (trx) => {
            // Gastar el link en la misma sentencia que lo comprueba
            const gastada = await trx('activaciones_usuario')
                .where({ id: activacion.id }).whereNull('usada_at').whereNull('revocada_at').where('vence_at', '>', trx.fn.now())
                .update({ usada_at: trx.fn.now() })
            if (!gastada) return null
            const existe = await trx('login').where({ email: activacion.email }).first('id')
            if (existe) await trx('login').where({ email: activacion.email }).update({ hash })
            else await trx('login').insert({ email: activacion.email, hash })
            // Cerrar las sesiones que hubiera (el cliente olvidó la contraseña:
            // si alguien más la tenía, queda afuera)
            const [fila] = await trx('users').where({ id: activacion.user_id }).increment('token_version', 1).returning('token_version')
            await registrarAuditoria(trx, { origen: ORIGEN.panel, accion: existe ? 'cliente_cambio_password' : 'cliente_activado', cuentaId: activacion.cuenta_id, ip: req.ip })
            return fila.token_version
        })
        if (version === null) return res.status(400).json(LINK_INVALIDO)
        recordar(activacion.user_id, version, { cuentaId: activacion.cuenta_id })
        res.json({ ok: true })
    } catch (err) {
        registrarError('POST /activar-cuenta', err)
        res.status(500).json({ error: 'Error en el servidor. Probá de nuevo en unos minutos.' })
    }
}
