// Activación de operadores del panel (etapa 2): las dos rutas públicas del
// link que da `npm run operadores -- crear`.
//   POST /admin/activacion { token }  -> { nombre, email, otpauth, secreto }
//       Para dibujar el QR. Solo con un link vigente. Cada vez que se abre
//       queda en la auditoría con la IP (revisión de Case de la etapa 2, M2):
//       si alguien más vio el link, `npm run operadores -- listar` lo avisa.
//   POST /admin/activar { token, password, codigo } -> { ok }
//       Guarda la contraseña y el segundo factor, y gasta el link. El código
//       prueba que la persona escaneó el QR: sin eso, quedaría con un segundo
//       factor que no tiene y no podría entrar.
// Con un link que no sirve (inexistente, usado, vencido, operador
// desactivado) siempre el mismo mensaje: no se distingue cuál.
import { validarPassword } from '../../utils/authValidation.js'
import { revisarFiltrada, MENSAJE_FILTRADA } from '../../utils/passwordFiltrada.js'
import { COSTO_BCRYPT } from '../register.js'
import { verificarCodigo, uriOtpauth } from '../../utils/totp.js'
import { descifrar } from '../../utils/cifrado.js'
import { activacionVigente, contextoOperador } from '../../services/operadores.js'
import { registrarAuditoria, ORIGEN } from '../../services/auditoria.js'
import { registrarError } from '../../utils/log.js'
import { registrarEvento } from '../../utils/eventos.js'

export const LINK_INVALIDO = {
    error: 'Este link de activación no es válido, ya se usó o venció. Pedile uno nuevo a quien te dio el acceso.',
    codigo: 'link_invalido',
}

export async function handleVerActivacion(req, res, db) {
    try {
        const activacion = await activacionVigente(db, req.body?.token)
        if (!activacion) {
            registrarEvento('admin_activacion_invalida', { ip: req.ip })
            return res.status(400).json(LINK_INVALIDO)
        }
        const secreto = descifrar(activacion.totp_secreto, contextoOperador(activacion.operador_id))
        await registrarAuditoria(db, { operadorId: activacion.operador_id, origen: ORIGEN.panel, accion: 'activacion_vista', ip: req.ip })
        res.json({
            nombre: activacion.nombre,
            email: activacion.email,
            otpauth: uriOtpauth(secreto, activacion.email),
            // Para cargarlo a mano si la cámara no lee el QR
            secreto,
        })
    } catch (err) {
        registrarError('POST /admin/activacion', err)
        res.status(500).json({ error: 'Error en el servidor. Probá de nuevo en unos minutos.' })
    }
}

export async function handleActivar(req, res, db, bcrypt) {
    const { token, password, codigo } = req.body ?? {}
    try {
        const activacion = await activacionVigente(db, token)
        if (!activacion) {
            registrarEvento('admin_activacion_invalida', { ip: req.ip })
            return res.status(400).json(LINK_INVALIDO)
        }

        // La misma política que los clientes, con su nombre y correo
        const errorPassword = typeof password === 'string'
            ? validarPassword(password, { email: activacion.email, name: activacion.nombre })
            : 'Elegí una contraseña.'
        if (errorPassword) return res.status(400).json({ error: errorPassword, errores: { password: errorPassword } })

        const paso = verificarCodigo(descifrar(activacion.totp_secreto, contextoOperador(activacion.operador_id)), codigo)
        if (paso === null) {
            const error = 'El código no es correcto. Mirá el que muestra ahora la app y volvé a probar.'
            return res.status(400).json({ error, errores: { codigo: error } })
        }

        const { filtrada } = await revisarFiltrada(password)
        if (filtrada) return res.status(400).json({ error: MENSAJE_FILTRADA, errores: { password: MENSAJE_FILTRADA } })

        const hash = await bcrypt.hash(password, COSTO_BCRYPT)
        const listo = await db.transaction(async (trx) => {
            // Gastar el link en la misma sentencia que lo comprueba: dos
            // pedidos con el mismo link no activan los dos. Se borra además la
            // copia del secreto que quedaba acá (Case, M2): vive solo en operadores.
            const gastada = await trx('activaciones_operador')
                .where({ id: activacion.id })
                .whereNull('usada_at')
                .where('vence_at', '>', trx.fn.now())
                .update({ usada_at: trx.fn.now(), totp_secreto: null })
            if (!gastada) return false
            // Solo si sigue activo (Case, B3): si mientras tanto lo
            // desactivaron, no se activa; se deshace todo.
            const actualizado = await trx('operadores').where({ id: activacion.operador_id, activo: true }).update({
                hash,
                totp_secreto: activacion.totp_secreto, // ya cifrado, atado a este operador
                ultimo_paso_totp: paso,
                activado_at: trx.fn.now(),
                desafio_id: null,
                // Corta cualquier sesión anterior (un reseteo)
                token_version: trx.raw('token_version + 1'),
            })
            if (!actualizado) throw new OperadorInactivo()
            await registrarAuditoria(trx, { operadorId: activacion.operador_id, origen: ORIGEN.panel, accion: 'operador_activado', ip: req.ip })
            return true
        })
        if (!listo) return res.status(400).json(LINK_INVALIDO)
        res.json({ ok: true })
    } catch (err) {
        if (err instanceof OperadorInactivo) return res.status(400).json(LINK_INVALIDO)
        registrarError('POST /admin/activar', err)
        res.status(500).json({ error: 'Error en el servidor. Probá de nuevo en unos minutos.' })
    }
}

class OperadorInactivo extends Error {}
