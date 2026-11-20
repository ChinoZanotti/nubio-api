import { registrarError } from '../utils/log.js'
import { normalizarMarca, validarMarca } from '../utils/marcaValidation.js'
import { reservarLugarEnCola } from '../services/alertas.js'

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

// Antes de guardar marcas nuevas se chequean dos topes, y ninguno puede tener
// carreras (tercera revisión de Case, B3): varias importaciones en paralelo
// pasaban todas el chequeo antes de que alguna terminara de insertar.
//
// 1) Lugar en la fila de alertas: se RESERVA (reservarLugarEnCola) antes de
//    insertar, en el mismo paso en que se revisa. Si después algo falla, se
//    libera; si entran menos marcas (duplicadas), se devuelve lo que sobró.
// 2) Tope de marcas por usuario: el COUNT y el INSERT van en una transacción
//    con un candado de Postgres por usuario (pg_advisory_xact_lock). Una
//    segunda importación del mismo usuario espera en la base a que termine la
//    primera, y cuenta las marcas que esa ya insertó. El candado se suelta solo
//    al terminar la transacción. Usa dos números: CANDADO_MARCAS dice "esto es
//    de marcas", así no choca con otro candado futuro que use el id del usuario.

const CANDADO_MARCAS = 1

const MENSAJES_FILA = {
    usuario: 'Todavía se están generando las alertas de tus marcas anteriores. Probá de nuevo en unos minutos.',
    servidor: 'El servidor está procesando muchas marcas. Probá de nuevo en unos minutos.',
}

// 503 = ocupado, no es un error del usuario: puede reintentar en un rato.
// Retry-After le dice cuántos segundos esperar.
function responderFilaLlena(res, falta) {
    res.set('Retry-After', '120')
    return res.status(503).json({ error: MENSAJES_FILA[falta] })
}

class TopeDeMarcasSuperado extends Error {
    constructor(actuales) {
        super(`Se pueden cargar hasta ${MAX_MARCAS_POR_USUARIO} marcas por cuenta (tenés ${actuales}).`)
        this.actuales = actuales
    }
}

// Inserta dentro de una transacción con el candado del usuario, después de
// comprobar que `nuevas` marcas más no pasan su tope. `insertar(trx)` hace el
// INSERT con la transacción y devuelve lo que inserte.
async function insertarConTope(db, userId, nuevas, insertar) {
    return db.transaction(async (trx) => {
        await trx.raw('select pg_advisory_xact_lock(?, ?)', [CANDADO_MARCAS, userId])
        const { total } = await trx('marcas').where({ user_id: userId }).count('* as total').first()
        if (Number(total) + nuevas > MAX_MARCAS_POR_USUARIO) throw new TopeDeMarcasSuperado(total)
        return insertar(trx)
    })
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

    const reserva = reservarLugarEnCola(userId, 1)
    if (reserva.falta) return responderFilaLlena(res, reserva.falta)

    try {
        const [nueva] = await insertarConTope(db, userId, 1,
            (trx) => trx('marcas').insert(aFila(marca, userId)).returning(COLUMNAS))
        // También por la fila, y sin esperar: si esperáramos y la fila estuviera
        // ocupada con importaciones de otros, este pedido quedaría colgado
        // minutos. Con la fila libre, las alertas están en menos de un segundo.
        // Va después del commit: el motor tiene que poder leer la marca.
        reserva.encolar(db, [nueva.id])
        res.status(201).json(nueva)
    } catch (err) {
        reserva.liberar()
        if (err instanceof TopeDeMarcasSuperado) {
            return res.status(400).json({ error: err.message })
        }
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

    // Reserva por las válidas, aunque algunas resulten duplicadas: es
    // conservador (puede rechazar un poco antes del tope exacto), pero nunca
    // se pasa. Lo que sobre se devuelve al encolar.
    const reserva = reservarLugarEnCola(userId, validas.length)
    if (reserva.falta) return responderFilaLlena(res, reserva.falta)

    try {
        // 2) Un solo INSERT con todas las filas. ON CONFLICT DO NOTHING saltea las
        // que ya existen (o que vienen repetidas en el mismo archivo) sin abortar el resto.
        const insertadas = await insertarConTope(db, userId, validas.length, (trx) => trx('marcas')
            .insert(validas.map((v) => aFila(v.marca, userId)))
            .onConflict(['user_id', 'pais', 'expediente'])
            .ignore()
            .returning(['id', 'pais', 'expediente']))

        // Sin await, a propósito: con cientos de marcas el motor tarda minutos.
        // Respondemos ya y las alertas se generan en segundo plano, en la fila
        // de trabajos (de a uno, cediendo el turno para no congelar la API).
        reserva.encolar(db, insertadas.map((m) => m.id))

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
        reserva.liberar()
        if (err instanceof TopeDeMarcasSuperado) {
            return res.status(400).json({ error: err.message })
        }
        if (err.code === FOREIGN_KEY_VIOLATION) {
            return res.status(400).json({ error: 'El usuario no existe.' })
        }
        registrarError('POST /marcas/bulk', err)
        res.status(500).json({ error: 'No se pudieron importar las marcas.' })
    }
}
