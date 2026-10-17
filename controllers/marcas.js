import { normalizarMarca, validarMarca } from '../utils/marcaValidation.js'

const MAX_IMPORTACION = 1000
const COLUMNAS = ['id', 'fecha_solicitud', 'expediente', 'clase_niza', 'denominacion', 'signo', 'titular', 'pais']

// Códigos de error de Postgres
const UNIQUE_VIOLATION = '23505'
const FOREIGN_KEY_VIOLATION = '23503'

// OJO: user_id llega del cliente porque todavía no hay token. Cualquiera puede
// mandar el id de otro usuario. Se reemplaza cuando entre JWT.
function parseUserId(valor) {
    const id = Number(valor)
    return Number.isInteger(id) && id > 0 ? id : null
}

// Arma la fila a insertar. Usamos solo los campos que devuelve normalizarMarca,
// así no se puede colar ninguna otra columna (ej: un "id" o "created_at" en el body).
function aFila(marca, userId) {
    return { ...marca, denominacion: marca.denominacion || null, user_id: userId }
}

export const handleGetMarcas = async (req, res, db) => {
    const userId = parseUserId(req.query.user_id)
    if (!userId) {
        return res.status(400).json({ error: 'user_id inválido.' })
    }

    try {
        const marcas = await db('marcas')
            .select(COLUMNAS)
            .where({ user_id: userId })
            .orderBy('fecha_solicitud', 'desc')
        res.json(marcas)
    } catch (err) {
        console.error(err)
        res.status(500).json({ error: 'No se pudieron obtener las marcas.' })
    }
}

export const handleCreateMarca = async (req, res, db) => {
    const userId = parseUserId(req.body.user_id)
    if (!userId) {
        return res.status(400).json({ error: 'user_id inválido.' })
    }

    const marca = normalizarMarca(req.body)
    const errores = validarMarca(marca)
    if (Object.keys(errores).length > 0) {
        return res.status(400).json({ error: Object.values(errores)[0], errores })
    }

    try {
        const [nueva] = await db('marcas').insert(aFila(marca, userId)).returning(COLUMNAS)
        res.status(201).json(nueva)
    } catch (err) {
        if (err.code === UNIQUE_VIOLATION) {
            return res.status(409).json({ error: 'Ya tenés una marca con ese expediente en ese país.' })
        }
        if (err.code === FOREIGN_KEY_VIOLATION) {
            return res.status(400).json({ error: 'El usuario no existe.' })
        }
        console.error(err)
        res.status(500).json({ error: 'No se pudo guardar la marca.' })
    }
}

export const handleCreateMarcasBulk = async (req, res, db) => {
    const userId = parseUserId(req.body.user_id)
    if (!userId) {
        return res.status(400).json({ error: 'user_id inválido.' })
    }

    const { marcas } = req.body
    if (!Array.isArray(marcas) || marcas.length === 0) {
        return res.status(400).json({ error: 'No se enviaron marcas.' })
    }
    if (marcas.length > MAX_IMPORTACION) {
        return res.status(400).json({ error: `Se pueden importar hasta ${MAX_IMPORTACION} marcas por vez.` })
    }

    // 1) Validar todo antes de tocar la base.
    // `fila` es la posición dentro del array recibido: el frontend la traduce
    // al número de fila del archivo.
    const errores = []
    const validas = []
    marcas.forEach((m, fila) => {
        const marca = normalizarMarca(m ?? {})
        const erroresFila = validarMarca(marca)
        if (Object.keys(erroresFila).length > 0) {
            errores.push({ fila, error: Object.values(erroresFila).join(' ') })
        } else {
            validas.push({ fila, marca })
        }
    })

    if (validas.length === 0) {
        return res.json({ insertadas: 0, errores })
    }

    try {
        // 2) Un solo INSERT con todas las filas. ON CONFLICT DO NOTHING saltea las
        // que ya existen (o que vienen repetidas en el mismo archivo) sin abortar el resto.
        const insertadas = await db('marcas')
            .insert(validas.map((v) => aFila(v.marca, userId)))
            .onConflict(['user_id', 'pais', 'expediente'])
            .ignore()
            .returning(['pais', 'expediente'])

        // 3) Las que no volvieron en `returning` son duplicadas.
        const clave = (m) => `${m.pais}|${m.expediente}`
        const pendientes = new Set(insertadas.map(clave))
        for (const { fila, marca } of validas) {
            if (pendientes.has(clave(marca))) {
                pendientes.delete(clave(marca)) // la primera aparición es la que entró
            } else {
                errores.push({ fila, error: 'Marca duplicada (mismo expediente y país).' })
            }
        }

        errores.sort((a, b) => a.fila - b.fila)
        res.json({ insertadas: insertadas.length, errores })
    } catch (err) {
        if (err.code === FOREIGN_KEY_VIOLATION) {
            return res.status(400).json({ error: 'El usuario no existe.' })
        }
        console.error(err)
        res.status(500).json({ error: 'No se pudieron importar las marcas.' })
    }
}
