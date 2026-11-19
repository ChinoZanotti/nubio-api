import { firmarToken } from '../utils/token.js'
import { normalizarEmail } from '../utils/authValidation.js'
import { COSTO_BCRYPT } from './register.js'
import { registrarError } from '../utils/log.js'

// Siempre el mismo mensaje: si dijéramos "ese email no existe", cualquiera
// podría averiguar quién tiene cuenta.
const CREDENCIALES_INVALIDAS = { error: 'Usuario o contraseña incorrectos.' }

// Hash de relleno para cuando el email no existe. Ver más abajo.
let hashDeRelleno = null

export const handleSignin = async (req, res, db, bcrypt) => {
    const email = normalizarEmail(req.body?.email)
    const { password } = req.body ?? {}
    // Solo tipos y vacío. NO se aplica el máximo de 72 bytes: si alguien se
    // registró antes con una contraseña más larga, bcrypt la truncó al guardar
    // y la trunca igual al comparar, así que le sigue funcionando.
    if (!email || typeof password !== 'string' || !password) {
        return res.status(400).json(CREDENCIALES_INVALIDAS)
    }

    try {
        const fila = await db('login').select('hash').where({ email }).first()

        // Igualar tiempos: bcrypt tarda ~200-300 ms a propósito (costo 12). Si cuando el
        // email no existe respondiéramos sin correrlo, la respuesta sería mucho
        // más rápida, y midiendo tiempos se sabría qué emails están registrados.
        // Por eso, sin usuario, comparamos igual contra un hash de relleno
        // (del mismo costo) y descartamos el resultado.
        // Mientras queden hashes de costo 10 sin migrar, un email existente
        // responde algo más rápido que uno inexistente (costo 12). Se cierra
        // solo: cada persona que entra pasa a costo 12.
        hashDeRelleno ??= await bcrypt.hash('relleno-para-igualar-tiempos', COSTO_BCRYPT)
        const valida = await bcrypt.compare(password, fila?.hash ?? hashDeRelleno)

        if (!fila || !valida) {
            return res.status(400).json(CREDENCIALES_INVALIDAS)
        }

        // Hashes viejos (costo menor al actual): este es el único momento en que
        // tenemos la contraseña en texto, así que aprovechamos para recalcular
        // el hash con el costo nuevo. Si falla, no impide entrar: queda para la
        // próxima vez.
        if (bcrypt.getRounds(fila.hash) < COSTO_BCRYPT) {
            try {
                const nuevo = await bcrypt.hash(password, COSTO_BCRYPT)
                await db('login').where({ email }).update({ hash: nuevo })
            } catch (err) {
                registrarError('Rehash en signin', err)
            }
        }

        // Columnas explícitas: con select('*') cualquier columna que se agregue
        // a users en el futuro saldría sola hacia el cliente.
        const user = await db('users')
            .select('id', 'name', 'email', 'joined')
            .where({ email })
            .first()

        // El token es la "credencial" que el frontend manda en cada pedido.
        // Lo firma el servidor con JWT_SECRET: el cliente no lo puede fabricar
        // ni cambiarle el id adentro sin que la firma deje de coincidir.
        res.json({ token: firmarToken(user.id), user })
    } catch (err) {
        registrarError('POST /signin', err)
        res.status(500).json({ error: 'Error en el servidor. Probá de nuevo en unos minutos.' })
    }
}
