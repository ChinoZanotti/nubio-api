import { validarNombre, validarPassword } from '../utils/authValidation.js'
import { revisarFiltrada, MENSAJE_FILTRADA } from '../utils/passwordFiltrada.js'
import { registrarError } from '../utils/log.js'
import { registrarEvento } from '../utils/eventos.js'
import { COSTO_BCRYPT } from './register.js'

// Columnas que se le devuelven al cliente. Explícitas, como en signin: con
// select('*') o returning('*') cualquier columna nueva de users saldría sola.
const COLUMNAS_USUARIO = ['id', 'name', 'email', 'joined']

// Tope de la contraseña ACTUAL, igual que en /signin: no se le aplica la
// política (puede ser vieja y corta), pero tampoco se procesan textos enormes.
const MAX_PASSWORD_ACTUAL = 1024

// Si llega algo que no es texto (array, objeto, número), se trata como vacío.
const comoTexto = (valor) => (typeof valor === 'string' ? valor : '')

// GET /me: los datos del usuario logueado. Reemplaza a GET /profile/:id, que
// devolvía cualquier usuario por id (con eso se podía armar la lista de emails
// de todos). Acá no hay id en la URL: el usuario sale del token.
export const handleMe = async (req, res, db) => {
    try {
        const user = await db('users')
            .select(COLUMNAS_USUARIO)
            .where({ id: req.userId })
            .first()

        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado.' })
        }
        res.json(user)
    } catch (err) {
        registrarError('GET /me', err)
        res.status(500).json({ error: 'No se pudo obtener el usuario.' })
    }
}

// PATCH /me con { name }: cambia el nombre del usuario logueado.
// Solo el nombre: el email es la identidad de la cuenta (está en `login` y en
// `users`) y cambiarlo pide confirmar el correo nuevo, que todavía no existe.
// Cualquier otro campo que llegue en el cuerpo se ignora.
export const handleUpdateMe = async (req, res, db) => {
    const name = comoTexto(req.body?.name).trim()
    const errorNombre = validarNombre(name)
    if (errorNombre) {
        return res.status(400).json({ error: errorNombre, errores: { name: errorNombre } })
    }

    try {
        const [user] = await db('users')
            .where({ id: req.userId })
            .update({ name })
            .returning(COLUMNAS_USUARIO)

        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado.' })
        }
        res.json(user)
    } catch (err) {
        registrarError('PATCH /me', err)
        res.status(500).json({ error: 'No se pudo guardar el nombre.' })
    }
}

// POST /me/password con { currentPassword, newPassword }: cambia la
// contraseña del usuario logueado.
//
// Por qué pide la actual aunque el pedido ya trae un token válido: el token
// puede estar en manos de otro (una computadora que quedó abierta, un XSS).
// Sin este paso, con el token alcanzaría para quedarse con la cuenta para
// siempre. Con él, el token solo dura lo que le queda (como mucho 8 h).
//
// Orden: primero lo barato y sin secretos (formato de la nueva), después
// bcrypt contra la actual, y al final Have I Been Pwned (servicio externo),
// solo si todo lo demás pasó. Así un intento con la actual equivocada no
// consulta a nadie de afuera.
//
// El limitador (limitadorCambioPassword, por usuario) frena a quien tenga el
// token y quiera usar esta ruta para adivinar la contraseña actual.
export const handleCambiarPassword = async (req, res, db, bcrypt) => {
    const currentPassword = comoTexto(req.body?.currentPassword)
    const newPassword = comoTexto(req.body?.newPassword)

    try {
        const user = await db('users').select('email', 'name').where({ id: req.userId }).first()
        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado.' })
        }

        // Las mismas reglas que el registro: largo, bytes, sin nombre ni correo.
        const errores = {}
        if (!currentPassword) errores.currentPassword = 'Ingresá tu contraseña actual.'
        const errorNueva = validarPassword(newPassword, user)
        if (errorNueva) errores.newPassword = errorNueva
        if (Object.keys(errores).length > 0) {
            return res.status(400).json({ error: Object.values(errores)[0], errores })
        }

        const fila = await db('login').select('hash').where({ email: user.email }).first()
        const actualValida =
            currentPassword.length <= MAX_PASSWORD_ACTUAL && fila && (await bcrypt.compare(currentPassword, fila.hash))
        if (!actualValida) {
            // Solo este rechazo cuenta para limitadorCambioPassword (ver ahí).
            res.locals.actualIncorrecta = true
            registrarEvento('password_cambio_rechazado', { email: user.email, ip: req.ip, usuario: req.userId, motivo: 'actual_incorrecta' })
            const mensaje = 'La contraseña actual no es correcta.'
            return res.status(400).json({ error: mensaje, errores: { currentPassword: mensaje } })
        }

        const { filtrada } = await revisarFiltrada(newPassword)
        if (filtrada) {
            registrarEvento('password_cambio_rechazado', { email: user.email, ip: req.ip, usuario: req.userId, motivo: 'password_filtrada' })
            return res.status(400).json({ error: MENSAJE_FILTRADA, errores: { newPassword: MENSAJE_FILTRADA } })
        }

        const hash = await bcrypt.hash(newPassword, COSTO_BCRYPT)
        const cambiadas = await db('login').where({ email: user.email }).update({ hash })
        // No debería pasar (la fila se leyó arriba), pero si no se cambió nada,
        // responder "ok" y registrar password_cambiada sería mentir.
        if (cambiadas !== 1) throw new Error(`El update de login cambió ${cambiadas} filas`)

        registrarEvento('password_cambiada', { email: user.email, ip: req.ip, usuario: req.userId })
        res.json({ ok: true })
    } catch (err) {
        registrarError('POST /me/password', err)
        res.status(500).json({ error: 'No se pudo cambiar la contraseña.' })
    }
}
