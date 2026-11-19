import { registrarError } from '../utils/log.js'
import { normalizarMarca, validarMarca } from '../utils/marcaValidation.js'
import { encolarAlertasParaMarcas, hayLugarEnCola } from '../services/alertas.js'

const MAX_IMPORTACION = 1000
// Tope de marcas por usuario. Un estudio grande vigila cientos o pocos miles
// de marcas; 5000 deja margen. Sin tope, una cuenta podía cargar marcas sin fin:
// cada una genera trabajo para el motor y filas en Neon (0,5 GB en el plan gratis).
export const MAX_MARCAS_POR_USUARIO = 5000
const COLUMNAS = ['id', 'fecha_solicitud', 'expediente', 'clase_niza', 'denominacion', 'signo', 'titular', 'pais']

// Códigos de error de Postgres
const UNIQUE_VIOLATION = '23505'
const FOREIGN_KEY_VIOLATION = '23503'

// El usuario sale SIEMPRE de req.userId, que lo pone el middleware requireAuth
// después de verificar el token. Si el body trae un user_id, se ignora.

// Arma la fila a insertar. Usamos solo los campos que devuelve normalizarMarca,
// así no se puede colar ninguna otra columna (ej: un "id" o "created_at" en el body).
function aFila(marca, userId) {
    return { ...marca, denominacion: marca.denominacion || null, user_id: userId }
}

// Antes de guardar `cantidad` marcas nuevas: ¿hay lugar en la fila de alertas y
// el usuario no se pasa de su tope? Devuelve null si se puede seguir, o
// { estado, error } para responder. Se chequea ANTES de insertar: si no, podrían
// quedar marcas guardadas que nunca reciben sus alertas.
async function verificarCapacidad(db, userId, cantidad) {
    if (!hayLugarEnCola(cantidad)) {
        // 503 = el servidor está ocupado, no es un error del usuario: puede reintentar.
        return { estado: 503, error: 'El servidor está procesando muchas marcas. Probá de nuevo en unos minutos.' }
    }
    const { total } = await db('marcas').where({ user_id: userId }).count('* as total').first()
    if (Number(total) + cantidad > MAX_MARCAS_POR_USUARIO) {
        return {
            estado: 400,
            error: `Se pueden cargar hasta ${MAX_MARCAS_POR_USUARIO} marcas por cuenta (tenés ${total}).`,
        }
    }
    return null
}

function responderCapacidad(res, problema) {
    // Retry-After: le dice al cliente cuántos segundos esperar antes de reintentar.
    if (problema.estado === 503) res.set('Retry-After', '120')
    return res.status(problema.estado).json({ error: problema.error })
}

export const handleGetMarcas = async (req, res, db) => {
    const { userId } = req

    try {
        const marcas = await db('marcas')
            .select(COLUMNAS)
            .where({ user_id: userId })
            .orderBy('fecha_solicitud', 'desc')
        res.json(marcas)
    } catch (err) {
        registrarError('GET /marcas', err)
        res.status(500).json({ error: 'No se pudieron obtener las marcas.' })
    }
}

export const handleCreateMarca = async (req, res, db) => {
    const { userId } = req

    const marca = normalizarMarca(req.body)
    const errores = validarMarca(marca)
    if (Object.keys(errores).length > 0) {
        return res.status(400).json({ error: Object.values(errores)[0], errores })
    }

    try {
        const problema = await verificarCapacidad(db, userId, 1)
        if (problema) return responderCapacidad(res, problema)

        const [nueva] = await db('marcas').insert(aFila(marca, userId)).returning(COLUMNAS)
        // También por la fila, y sin esperar: si esperáramos y la fila estuviera
        // ocupada con importaciones de otros, este pedido quedaría colgado
        // minutos. Con la fila libre, las alertas están en menos de un segundo.
        encolarAlertasParaMarcas(db, [nueva.id])
        res.status(201).json(nueva)
    } catch (err) {
        if (err.code === UNIQUE_VIOLATION) {
            return res.status(409).json({ error: 'Ya tenés una marca con ese expediente en ese país.' })
        }
        if (err.code === FOREIGN_KEY_VIOLATION) {
            return res.status(400).json({ error: 'El usuario no existe.' })
        }
        registrarError('POST /marcas', err)
        res.status(500).json({ error: 'No se pudo guardar la marca.' })
    }
}

export const handleCreateMarcasBulk = async (req, res, db) => {
    const { userId } = req

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
        // Cuenta las válidas, aunque algunas resulten duplicadas: es conservador
        // (puede rechazar un poco antes del tope exacto), pero nunca se pasa.
        const problema = await verificarCapacidad(db, userId, validas.length)
        if (problema) return responderCapacidad(res, problema)

        // 2) Un solo INSERT con todas las filas. ON CONFLICT DO NOTHING saltea las
        // que ya existen (o que vienen repetidas en el mismo archivo) sin abortar el resto.
        const insertadas = await db('marcas')
            .insert(validas.map((v) => aFila(v.marca, userId)))
            .onConflict(['user_id', 'pais', 'expediente'])
            .ignore()
            .returning(['id', 'pais', 'expediente'])

        // Sin await, a propósito: con cientos de marcas el motor tarda minutos.
        // Respondemos ya y las alertas se generan en segundo plano, en la fila
        // de trabajos (de a uno, cediendo el turno para no congelar la API).
        encolarAlertasParaMarcas(db, insertadas.map((m) => m.id))

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
        registrarError('POST /marcas/bulk', err)
        res.status(500).json({ error: 'No se pudieron importar las marcas.' })
    }
}
