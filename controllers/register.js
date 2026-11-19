import { validarRegistro } from '../utils/authValidation.js'
import { registrarError } from '../utils/log.js'
import { revisarFiltrada, MENSAJE_FILTRADA } from '../utils/passwordFiltrada.js'

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
        return res.status(400).json({ error: Object.values(errores)[0], errores })
    }
    const { name, email, password } = datos

    try {
        // Después de las reglas síncronas: esta puede consultar un servicio
        // externo (Have I Been Pwned), así que va solo si todo lo demás pasó.
        const { filtrada } = await revisarFiltrada(password)
        if (filtrada) {
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

        res.json(user)
    } catch (err) {
        // Email ya registrado. Mensaje genérico y log sin err.detail: Postgres
        // pone ahí el email ("Key (email)=(...) already exists") y no queremos
        // datos personales en los logs.
        if (err.code === UNIQUE_VIOLATION) {
            console.error('Registro rechazado: email duplicado')
            return res.status(400).json({ error: 'No se pudo completar el registro.' })
        }
        registrarError('POST /register', err)
        res.status(500).json({ error: 'No se pudo completar el registro.' })
    }
}
