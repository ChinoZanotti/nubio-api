import { firmarToken } from '../utils/token.js'
import { normalizarEmail, validarEmail } from '../utils/authValidation.js'
import { COSTO_BCRYPT } from './register.js'
import { registrarError } from '../utils/log.js'
import { esperaPendiente, registrarIntento, registrarExito, esIpConocida } from '../utils/intentosPorCuenta.js'
import { registrarEvento } from '../utils/eventos.js'

// Tope de largo de la contraseña en el login (en caracteres). Muy por encima
// de cualquier contraseña real; solo evita procesar textos enormes.
const MAX_PASSWORD_SIGNIN = 1024

// Siempre el mismo mensaje: si dijéramos "ese email no existe", cualquiera
// podría averiguar quién tiene cuenta.
const CREDENCIALES_INVALIDAS = { error: 'Usuario o contraseña incorrectos.' }

// Hash de relleno para cuando el email no existe. Ver más abajo.
let hashDeRelleno = null

export const handleSignin = async (req, res, db, bcrypt) => {
    const email = normalizarEmail(req.body?.email)
    const { password } = req.body ?? {}
    // Tipos, formato y largo, ANTES de contar nada (tercera revisión de Case,
    // A1): un "email" de 1 MB que llegara al límite por cuenta llenaba la
    // memoria. validarEmail exige formato y máximo 254 caracteres.
    // La contraseña NO tiene el máximo de 72 bytes del registro (quien se
    // registró antes con una más larga sigue entrando: bcrypt la trunca igual
    // al comparar), pero sí un tope generoso para no procesar textos enormes.
    if (!email || validarEmail(email) || typeof password !== 'string' || !password || password.length > MAX_PASSWORD_SIGNIN) {
        return res.status(400).json(CREDENCIALES_INVALIDAS)
    }

    // Límite por cuenta (utils/intentosPorCuenta.js): va ANTES de bcrypt, así
    // los intentos frenados no gastan CPU. Aplica igual a emails que no existen.
    // Desde una IP donde este email ya entró antes, no hay demora (ver ahí).
    const espera = esperaPendiente(email, req.ip)
    if (espera > 0) {
        registrarEvento('login_demorado', { email, ip: req.ip, espera })
        res.set('Retry-After', String(espera))
        return res.status(429).json({
            error: `Hubo muchos intentos fallidos con este correo. Esperá ${espera} ${espera === 1 ? 'segundo' : 'segundos'} y volvé a probar.`,
        })
    }

    // Se reserva el intento YA, antes de los await (base y bcrypt, ~500 ms).
    // Si se registrara después, todos los pedidos que llegan en paralelo
    // pasarían el chequeo de arriba (tercera revisión, M3). Si el login sale
    // bien, registrarExito lo borra.
    registrarIntento(email)

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
            // El fallo ya quedó contado con registrarIntento.
            // En el evento SÍ se distingue si la cuenta existe (el usuario no lo
            // ve, el log sí): muchos fallos contra cuentas que no existen son un
            // barrido; contra una que existe, un ataque dirigido.
            registrarEvento('login_fallido', { email, ip: req.ip, cuentaExiste: Boolean(fila) })
            return res.status(400).json(CREDENCIALES_INVALIDAS)
        }
        // ipNueva: entrar desde un lugar desde donde esta cuenta nunca entró es
        // lo primero que conviene mirar si se sospecha un robo de contraseña.
        registrarEvento('login_ok', { email, ip: req.ip, ipNueva: !esIpConocida(email, req.ip) })
        registrarExito(email, req.ip)

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
        // token_version va al token, no al cliente: se separa de `user`.
        const { token_version: tokenVersion, ...user } = await db('users')
            .select('id', 'name', 'email', 'joined', 'token_version')
            .where({ email })
            .first()

        // El token es la "credencial" que el frontend manda en cada pedido.
        // Lo firma el servidor con JWT_SECRET: el cliente no lo puede fabricar
        // ni cambiarle el id adentro sin que la firma deje de coincidir.
        // Lleva la versión vigente de las sesiones (ver utils/versionToken.js).
        res.json({ token: firmarToken(user.id, tokenVersion), user })
    } catch (err) {
        registrarError('POST /signin', err)
        res.status(500).json({ error: 'Error en el servidor. Probá de nuevo en unos minutos.' })
    }
}
