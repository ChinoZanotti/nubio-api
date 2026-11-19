import { validarRegistro } from '../utils/authValidation.js'
import { registrarError } from '../utils/log.js'

// Costo de bcrypt: cada +1 duplica el tiempo de calcular el hash (y de probar
// contraseñas por fuerza bruta si alguien se roba la tabla). 10 es el mínimo
// razonable hoy. Tiene que ser el mismo que usa signin para el hash de relleno.
export const COSTO_BCRYPT = 10

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
