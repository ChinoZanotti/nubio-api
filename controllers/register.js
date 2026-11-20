import { validarRegistro } from '../utils/authValidation.js'
import { registrarError } from '../utils/log.js'
import { revisarFiltrada, MENSAJE_FILTRADA } from '../utils/passwordFiltrada.js'
import { registrarEvento } from '../utils/eventos.js'

// Costo de bcrypt: cada +1 duplica el tiempo de calcular el hash (y de probar
// contraseñas por fuerza bruta si alguien se roba la tabla). Pasó de 10 a 12
// (4 veces más caro). Los hashes viejos de costo 10 siguen funcionando: signin
// los vuelve a calcular con 12 la próxima vez que esa persona entra.
// Tiene que ser el mismo que usa signin para el hash de relleno.
export const COSTO_BCRYPT = 12

const UNIQUE_VIOLATION = '23505'

export const handleRegister = async (req, res, db, bcrypt) => {
    // validarRegistro revisa tipos (que sean texto), normaliza el email a
    // minúsculas y aplica las mismas reglas que el formulario del frontend.
    const { datos, errores } = validarRegistro(req.body ?? {})
    if (Object.keys(errores).length > 0) {
        // Sin el email: puede ser inválido (o enorme). Solo qué campos fallaron.
        registrarEvento('registro_rechazado', { ip: req.ip, motivo: 'validacion', campos: Object.keys(errores) })
        return res.status(400).json({ error: Object.values(errores)[0], errores })
    }
    const { name, email, password } = datos

    try {
        // Después de las reglas síncronas: esta puede consultar un servicio
        // externo (Have I Been Pwned), así que va solo si todo lo demás pasó.
        const { filtrada } = await revisarFiltrada(password)
        if (filtrada) {
            registrarEvento('registro_rechazado', { email, ip: req.ip, motivo: 'password_filtrada' })
            return res.status(400).json({ error: MENSAJE_FILTRADA, errores: { password: MENSAJE_FILTRADA } })
        }

        const hash = await bcrypt.hash(password, COSTO_BCRYPT)

        const user = await db.transaction(async (trx) => {
            await trx('login').insert({ hash, email })
            const [nuevo] = await trx('users')
                .insert({ email, name, joined: new Date() })
                .returning(['id', 'name', 'email', 'joined'])
            return nuevo
        })

        registrarEvento('registro_ok', { email, ip: req.ip, usuario: user.id })
        res.json(user)
    } catch (err) {
        // Email ya registrado. Mensaje genérico al usuario y evento sin el email
        // en claro (Postgres lo pone en err.detail: "Key (email)=(...)").
        if (err.code === UNIQUE_VIOLATION) {
            registrarEvento('registro_rechazado', { email, ip: req.ip, motivo: 'duplicado' })
            return res.status(400).json({ error: 'No se pudo completar el registro.' })
        }
        registrarError('POST /register', err)
        res.status(500).json({ error: 'No se pudo completar el registro.' })
    }
}
