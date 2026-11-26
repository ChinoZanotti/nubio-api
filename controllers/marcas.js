import { registrarError } from '../utils/log.js'
import { normalizarMarca, validarMarca, camposConTipoInvalido } from '../utils/marcaValidation.js'
import { reservarLugarEnCola } from '../services/alertas.js'
import { parseId } from '../utils/id.js'
import { registrarEvento } from '../utils/eventos.js'

const MAX_IMPORTACION = 1000
// Tope de marcas por usuario. Un estudio grande vigila cientos o pocos miles
// de marcas; 5000 deja margen. Sin tope, una cuenta podía cargar marcas sin fin:
// cada una genera trabajo para el motor y filas en Neon (0,5 GB en el plan gratis).
export const MAX_MARCAS_POR_USUARIO = 5000
// version: sube con cada edición (sql/009_marcas_version.sql). El frontend la
// devuelve al editar, para saber si otra persona guardó antes.
// estado, numero_registro, fecha_registro, fecha_vencimiento: datos del
// registro, opcionales (sql/010_marcas_registro.sql).
const COLUMNAS = [
    'id', 'fecha_solicitud', 'expediente', 'clase_niza', 'denominacion', 'signo', 'titular', 'pais', 'version',
    'estado', 'numero_registro', 'fecha_registro', 'fecha_vencimiento',
]

// Códigos de error de Postgres
const UNIQUE_VIOLATION = '23505'
const FOREIGN_KEY_VIOLATION = '23503'
// Un CHECK de la base (largo máximo, signo válido...). validarMarca aplica las
// mismas reglas antes, así que no debería pasar; si algún día se desalinean,
// es un dato inválido (400), no un error del servidor (500).
const CHECK_VIOLATION = '23514'

// El usuario sale SIEMPRE de req.userId, que lo pone el middleware requireAuth
// después de verificar el token. Si el body trae un user_id, se ignora.

// Arma la fila a insertar. Usamos solo los campos que devuelve normalizarMarca,
// así no se puede colar ninguna otra columna (ej: un "id" o "created_at" en el body).
// Lo que viene vacío ('') se guarda como NULL: "sin dato", no un texto vacío
// (y una fecha '' ni siquiera entra en una columna DATE).
function aFila(marca, userId) {
    return {
        ...marca,
        denominacion: marca.denominacion || null,
        estado: marca.estado || null,
        numero_registro: marca.numero_registro || null,
        fecha_registro: marca.fecha_registro || null,
        fecha_vencimiento: marca.fecha_vencimiento || null,
        user_id: userId,
    }
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

    // Tipos primero (revisión de Case del registro, B1): un objeto o una lista
    // en un campo no llega a normalizarMarca.
    const erroresTipo = camposConTipoInvalido(req.body)
    if (Object.keys(erroresTipo).length > 0) {
        return res.status(400).json({ error: Object.values(erroresTipo)[0], errores: erroresTipo })
    }
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
        res.locals.escrituraPesada = true // cuenta para limitadorEscrituraMarcas
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
        if (err.code === CHECK_VIOLATION) {
            return res.status(400).json({ error: 'Algún dato de la marca no es válido.' })
        }
        registrarError('POST /marcas', err)
        res.status(500).json({ error: 'No se pudo guardar la marca.' })
    }
}

// Los datos que usa el motor de similitud. Si la edición cambia alguno, las
// alertas de la marca se calcularon con datos viejos y hay que regenerarlas.
// Titular, país y fecha no influyen en el puntaje.
const CAMPOS_DEL_MOTOR = ['denominacion', 'clase_niza', 'signo', 'expediente']
const cambioParaElMotor = (antes, despues) =>
    CAMPOS_DEL_MOTOR.some((c) => String(antes[c] ?? '') !== String(despues[c] ?? ''))

// Datos del registro (sql/010): opcionales, y si un PATCH no los trae se
// conservan (ver handleUpdateMarca).
const CAMPOS_OPCIONALES = ['estado', 'numero_registro', 'fecha_registro', 'fecha_vencimiento']
// Todo lo que se puede editar: para el rastro de qué cambió.
const CAMPOS_EDITABLES = ['fecha_solicitud', 'expediente', 'clase_niza', 'denominacion', 'signo', 'titular', 'pais', ...CAMPOS_OPCIONALES]

// Edita una marca (PATCH /marcas/:id): se manda la marca completa (el mismo
// formulario que el alta, la misma validación) y la `version` que se leyó.
//
// Todas las consultas llevan user_id: una marca de otra cuenta responde 404,
// igual que una que no existe, para no revelar que existe.
//
// Ediciones simultáneas (revisión de Case, M2 y B3): el UPDATE solo se aplica
// si la versión en la base sigue siendo la que mandó el formulario, y la sube
// en 1. Si otra persona guardó antes, no se pisa lo suyo: 409 con
// codigo 'marca_modificada', y el frontend pide recargar. Esto también cierra
// la carrera entre leer `anterior` y el UPDATE: si alguien guardó en el medio,
// la versión ya no coincide.
export const handleUpdateMarca = async (req, res, db) => {
    const { userId } = req
    const id = parseId(req.params.id)
    if (!id) return res.status(400).json({ error: 'Parámetros inválidos.' })

    const version = Number(req.body?.version)
    if (!Number.isInteger(version) || version < 1) {
        return res.status(400).json({ error: 'Falta la versión de la marca. Recargá la página y volvé a probar.' })
    }

    const erroresTipo = camposConTipoInvalido(req.body)
    if (Object.keys(erroresTipo).length > 0) {
        return res.status(400).json({ error: Object.values(erroresTipo)[0], errores: erroresTipo })
    }

    let reserva = null
    try {
        const anterior = await db('marcas').select(COLUMNAS).where({ id, user_id: userId }).first()
        if (!anterior) return res.status(404).json({ error: 'Marca no encontrada.' })
        if (anterior.version !== version) return responderModificada(res)

        // Los campos opcionales que NO vienen en el pedido se conservan
        // (revisión de Case del registro, M1). Sin esto, una pestaña abierta
        // con el frontend de antes de estos campos (o cualquier cliente que no
        // los mande) los dejaba en NULL sin aviso: la versión coincidía, así
        // que nada lo frenaba, y se perdía la fecha de vencimiento. Se
        // completan ANTES de validar, para que la regla "vencimiento posterior
        // al registro" compare con el dato que va a quedar guardado.
        const entrada = { ...req.body }
        for (const campo of CAMPOS_OPCIONALES) {
            if (!(campo in entrada)) entrada[campo] = anterior[campo]
        }
        const marca = normalizarMarca(entrada)
        const errores = validarMarca(marca)
        if (Object.keys(errores).length > 0) {
            return res.status(400).json({ error: Object.values(errores)[0], errores })
        }
        // Sin user_id en el SET (revisión de Case, I1): el WHERE ya fija la
        // cuenta, y así el UPDATE no puede ni siquiera escribir esa columna.
        const { user_id: _cuenta, ...cambios } = aFila(marca, userId)

        // Si hay que regenerar alertas, se reserva lugar en la fila ANTES de
        // guardar, como en el alta: si la fila está llena, no queda una marca
        // cambiada con alertas viejas.
        const regenerar = cambioParaElMotor(anterior, cambios)
        if (regenerar) {
            reserva = reservarLugarEnCola(userId, 1)
            if (reserva.falta) return responderFilaLlena(res, reserva.falta)
        }

        const [actualizada] = await db('marcas')
            .where({ id, user_id: userId, version })
            .update({ ...cambios, version: db.raw('version + 1') })
            .returning(COLUMNAS)
        if (!actualizada) {
            // Otra persona guardó (o borró) entre la lectura y el UPDATE
            reserva?.liberar()
            const sigue = await db('marcas').where({ id, user_id: userId }).first('id')
            return sigue ? responderModificada(res) : res.status(404).json({ error: 'Marca no encontrada.' })
        }

        if (regenerar) {
            reserva.encolar(db, [id], { regenerar: true })
            res.locals.escrituraPesada = true // cuenta para limitadorEscrituraMarcas
        }
        // Rastro de quién cambió qué: cualquier cambio, no solo los que mueven
        // al motor (revisiones de Case: M3 de editar/borrar, M2 del registro).
        // Cambiar o borrar una fecha de vencimiento también tiene que poder
        // atribuirse. Van los NOMBRES de los campos, no los valores.
        // Expediente y país son datos públicos de DINAPI.
        const camposCambiados = CAMPOS_EDITABLES.filter((c) => String(anterior[c] ?? '') !== String(actualizada[c] ?? ''))
        if (camposCambiados.length > 0) {
            registrarEvento('marca_editada', {
                usuario: userId, sesion: req.sesionId, ip: req.ip, marca_id: id,
                expediente: actualizada.expediente, pais: actualizada.pais, campos_cambiados: camposCambiados,
            })
        }
        res.json(actualizada)
    } catch (err) {
        reserva?.liberar()
        if (err.code === UNIQUE_VIOLATION) {
            return res.status(409).json({ error: 'Ya tenés otra marca con ese expediente en ese país.' })
        }
        if (err.code === CHECK_VIOLATION) {
            return res.status(400).json({ error: 'Algún dato de la marca no es válido.' })
        }
        registrarError('PATCH /marcas', err)
        res.status(500).json({ error: 'No se pudo guardar la marca.' })
    }
}

function responderModificada(res) {
    return res.status(409).json({
        error: 'Otra persona modificó esta marca mientras la editabas. Volvé a la lista para ver los datos actuales.',
        codigo: 'marca_modificada',
    })
}

// Borra una marca (DELETE /marcas/:id). Sus alertas se borran solas (ON DELETE
// CASCADE en sql/003_alertas.sql), con sus estados y notas: no hay papelera.
//
// Queda en el registro de eventos (revisión de Case, M3): con la cuenta
// compartida y oposiciones con plazo, un borrado por error tiene que poder
// atribuirse a una sesión. Cuenta además cuántas alertas trabajadas (con
// estado o nota) se perdieron, para saber si importaba.
export const handleDeleteMarca = async (req, res, db) => {
    const { userId } = req
    const id = parseId(req.params.id)
    if (!id) return res.status(400).json({ error: 'Parámetros inválidos.' })

    try {
        // En una transacción: primero se cuentan las alertas trabajadas (las de
        // una marca de OTRA cuenta no se cuentan: el JOIN filtra por user_id) y
        // después se borra. Así la cuenta es de lo que efectivamente se perdió.
        const resultado = await db.transaction(async (trx) => {
            const { trabajadas } = await trx('alertas as a')
                .join('marcas as m', 'm.id', 'a.marca_id')
                .where({ 'm.id': id, 'm.user_id': userId })
                .where((q) => q.whereNot('a.estado', 'nueva').orWhereNotNull('a.nota'))
                .count('* as trabajadas')
                .first()
            const [borrada] = await trx('marcas').where({ id, user_id: userId }).del().returning(['expediente', 'pais'])
            return borrada ? { ...borrada, trabajadas: Number(trabajadas) } : null
        })
        if (!resultado) return res.status(404).json({ error: 'Marca no encontrada.' })

        res.locals.escrituraPesada = true // cuenta para limitadorEscrituraMarcas
        registrarEvento('marca_borrada', {
            usuario: userId, sesion: req.sesionId, ip: req.ip, marca_id: id,
            expediente: resultado.expediente, pais: resultado.pais, alertas_trabajadas: resultado.trabajadas,
        })
        res.status(204).end()
    } catch (err) {
        registrarError('DELETE /marcas', err)
        res.status(500).json({ error: 'No se pudo eliminar la marca.' })
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
        // Tipos primero (B1): una fila con un objeto o una lista es un error de
        // ESA fila; antes hacía fallar la importación entera con un 500.
        const erroresTipo = camposConTipoInvalido(m)
        if (Object.keys(erroresTipo).length > 0) {
            errores.push({ fila, error: Object.values(erroresTipo).join(' ') })
            return
        }
        const marca = normalizarMarca(m)
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
        if (err.code === CHECK_VIOLATION) {
            return res.status(400).json({ error: 'Algún dato de las marcas no es válido.' })
        }
        registrarError('POST /marcas/bulk', err)
        res.status(500).json({ error: 'No se pudieron importar las marcas.' })
    }
}
