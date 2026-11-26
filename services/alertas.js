import { compararPreparadas, prepararMarca, UMBRAL_ALERTA } from '../utils/similitud/index.js'
import { hoy, venceOposicion } from '../utils/plazos.js'
import { registrarError } from '../utils/log.js'

const COLUMNAS_MARCA = ['id', 'expediente', 'clase_niza', 'denominacion', 'signo']
const COLUMNAS_BOLETIN = ['id', 'fecha_publicacion', 'expediente', 'clase_niza', 'denominacion', 'signo', 'tramite']

// 60 días hábiles son unos 85 días corridos; 100 deja margen para feriados.
// Es solo un prefiltro en SQL: el plazo exacto se calcula después en JS.
const DIAS_CORRIDOS_PREFILTRO = 100

const tieneTexto = (m) => m.signo !== 'F' && Boolean(m.denominacion?.trim())

// Reglas que descartan un par antes de compararlo:
// - figurativas puras: no hay texto que comparar;
// - renovaciones: no se oponen como una solicitud nueva (PENDIENTE validar con el abogado);
// - mismo expediente: es la propia solicitud del usuario publicada en el boletín.
function esComparable(marca, publicada) {
    return tieneTexto(marca)
        && tieneTexto(publicada)
        && !publicada.tramite.startsWith('Renovación')
        && marca.expediente !== publicada.expediente
}

// Node atiende todo en un solo hilo: mientras el motor compara, ningún otro
// pedido avanza. Cada TRAMO_MS cedemos el turno con setImmediate: Node atiende
// lo que esté esperando (otros usuarios) y después seguimos donde quedamos.
// Tarda lo mismo en total, pero la API no se congela.
const TRAMO_MS = 20
const cederTurno = () => new Promise((resolve) => setImmediate(resolve))

// El chequeo es síncrono y el await va solo cuando toca ceder: un await en
// cada par (millones) sumaría segundos de espera inútil.
// Uso: `if (pausa.toca()) await pausa.ceder()` dentro de los bucles largos.
function crearPausa() {
    let inicioTramo = performance.now()
    return {
        toca: () => performance.now() - inicioTramo > TRAMO_MS,
        async ceder() {
            await cederTurno()
            inicioTramo = performance.now()
        },
    }
}

// Cada marca del boletín se prepara (normaliza + claves fonéticas) UNA vez,
// no en cada par. Son miles: también se cede el turno mientras se preparan.
async function prepararTodas(publicadas, pausa) {
    const preparadas = new Map()
    for (const publicada of publicadas) {
        if (pausa.toca()) await pausa.ceder()
        preparadas.set(publicada, prepararMarca(publicada))
    }
    return preparadas
}

// `preparadas` es opcional: si ya vienen preparadas (del caché), se reusan.
async function generarPares(marcas, publicadas, preparadas = null) {
    const pausa = crearPausa()
    preparadas ??= await prepararTodas(publicadas, pausa)

    const filas = []
    for (const marca of marcas) {
        const mia = prepararMarca(marca)
        for (const publicada of publicadas) {
            if (pausa.toca()) await pausa.ceder()
            if (!esComparable(marca, publicada)) continue
            const r = compararPreparadas(mia, preparadas.get(publicada))
            if (r.score < UMBRAL_ALERTA) continue
            filas.push({
                marca_id: marca.id,
                boletin_marca_id: publicada.id,
                score: r.score,
                nivel: r.nivel,
                motivos: r.motivos,
                relacion_clase: r.relacionClase,
            })
        }
    }
    return filas
}

// Postgres acepta hasta 65535 parámetros por consulta; cada alerta usa 6.
// En tandas de 1000 queda lejos del límite aunque una importación genere miles.
const TANDA_INSERT = 1000

// Devuelve cuántas alertas nuevas se crearon. Las que ya existían se ignoran,
// así no se pisa el estado ni la nota que el usuario ya cargó.
async function insertar(db, filas) {
    let total = 0
    for (let i = 0; i < filas.length; i += TANDA_INSERT) {
        total += await insertarTanda(db, filas.slice(i, i + TANDA_INSERT))
    }
    return total
}

const FOREIGN_KEY_VIOLATION = '23503'

const insertarFilas = (db, filas) => db('alertas')
    .insert(filas)
    .onConflict(['marca_id', 'boletin_marca_id'])
    .ignore()
    .returning('id')

// Generar las alertas de una importación tarda minutos. Si en ese rato el
// usuario borra una de esas marcas, el INSERT de la tanda entera falla por la
// clave foránea (la alerta apunta a una marca que ya no existe), y se perdían
// las alertas de TODAS las marcas de la tanda. Ante ese error se vuelve a
// intentar solo con las filas cuya marca Y cuya publicación siguen existiendo
// (la publicación también es clave foránea: revisión de Case, B2). Si el
// segundo intento también falla (otro borrado justo en ese instante), el error
// se registra.
//
// `db` puede ser la base o una transacción (al regenerar). El primer intento va
// en su propio db.transaction: dentro de una transacción es un SAVEPOINT. Sin
// eso, en Postgres un INSERT fallido deja la transacción entera inutilizable y
// el reintento también fallaría.
async function insertarTanda(db, filas) {
    if (filas.length === 0) return 0
    try {
        return (await db.transaction((t) => insertarFilas(t, filas))).length
    } catch (err) {
        if (err.code !== FOREIGN_KEY_VIOLATION) throw err
        const unicos = (campo) => [...new Set(filas.map((f) => f[campo]))]
        const marcas = new Set(await db('marcas').whereIn('id', unicos('marca_id')).pluck('id'))
        const publicadas = new Set(await db('boletin_marcas').whereIn('id', unicos('boletin_marca_id')).pluck('id'))
        const quedan = filas.filter((f) => marcas.has(f.marca_id) && publicadas.has(f.boletin_marca_id))
        return quedan.length === 0 ? 0 : (await insertarFilas(db, quedan)).length
    }
}

// Un boletín nuevo se compara contra las marcas de TODOS los usuarios.
export async function generarAlertasParaBoletin(db, fechaPublicacion) {
    const publicadas = await db('boletin_marcas').select(COLUMNAS_BOLETIN).where({ fecha_publicacion: fechaPublicacion })
    const marcas = await db('marcas').select(COLUMNAS_MARCA)
    return insertar(db, await generarPares(marcas, publicadas))
}

// Caché de lo publicado con plazo abierto, ya preparado. Traer y preparar las
// ~9000 publicaciones cuesta unos 300 ms: más que comparar una marca sola. Sin
// caché se repetía en cada trabajo; con caché, una vez por día o por boletín.
//
// La clave cambia si cambia el día (algunas publicaciones dejan de estar en
// plazo) o si entra o sale un boletín (cambia el id máximo o la cantidad). El
// importador corre en otro proceso y no puede avisarle al servidor: por eso se
// compara la clave, que es una consulta barata, en cada trabajo.
//
// Hay una sola copia en memoria, y los trabajos corren de a uno (ver la fila):
// nunca hay dos preparándola a la vez.
let cachePublicadas = null

async function publicadasEnPlazo(db) {
    const hoyPy = hoy()
    const desde = new Date(Date.now() - DIAS_CORRIDOS_PREFILTRO * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const resumen = await db('boletin_marcas')
        .where('fecha_publicacion', '>=', desde)
        .max('id as maximo')
        .count('* as cantidad')
        .first()
    const clave = `${hoyPy}|${desde}|${resumen.maximo}|${resumen.cantidad}`
    if (cachePublicadas?.clave === clave) return cachePublicadas

    // Lo que ya venció no es accionable: no se compara.
    const publicadas = (await db('boletin_marcas').select(COLUMNAS_BOLETIN).where('fecha_publicacion', '>=', desde))
        .filter((p) => venceOposicion(p.fecha_publicacion) >= hoyPy)
    const preparadas = await prepararTodas(publicadas, crearPausa())
    cachePublicadas = { clave, publicadas, preparadas }
    return cachePublicadas
}

// Marcas nuevas de un usuario contra lo publicado que todavía se puede oponer.
// Desde el servidor se llama SIEMPRE a través de la fila (encolarAlertasParaMarcas).
//
// `regenerar: true` es para una marca EDITADA en lo que compara el motor
// (denominación, clase, signo o expediente): primero borra sus alertas que nadie
// tocó (estado "nueva" y sin nota), que se calcularon con los datos viejos, y
// después compara de nuevo. Las que el usuario ya revisó se conservan: son su
// trabajo. Se hace acá, dentro del trabajo, y no en el pedido de edición: la
// fila corre de a un trabajo, así que si la marca todavía tenía pendiente su
// trabajo de alta (con los datos viejos), ese ya terminó cuando llega este.
//
// Orden (revisión de Case, B1): primero se compara (lo lento, sin tocar la
// base) y recién al final se borra y se inserta, juntos en una transacción.
// Antes se borraba primero: si el trabajo fallaba en el medio (un error de la
// base, un reinicio), la marca quedaba SIN alertas hasta un recalcular-alertas.
// Ahora, si algo falla, la transacción se deshace y quedan las alertas viejas.
// De paso, la pantalla de Alertas nunca ve un instante sin alertas.
export async function generarAlertasParaMarcas(db, marcaIds, { regenerar = false } = {}) {
    if (marcaIds.length === 0) return 0
    const marcas = await db('marcas').select(COLUMNAS_MARCA).whereIn('id', marcaIds)
    const { publicadas, preparadas } = await publicadasEnPlazo(db)
    const filas = await generarPares(marcas, publicadas, preparadas)
    if (!regenerar) return insertar(db, filas)

    return db.transaction(async (trx) => {
        await trx('alertas')
            .whereIn('marca_id', marcaIds)
            .where({ estado: 'nueva' })
            .whereNull('nota')
            .del()
        return insertar(trx, filas)
    })
}

// Fila de trabajos en segundo plano: las generaciones corren de a UNA.
// Si llegan diez importaciones juntas, no compiten por la CPU ni cargan diez
// copias de las publicaciones en memoria: esperan su turno.
// `cola` es siempre la promesa del último trabajo; cada uno nuevo se engancha atrás.
//
// Tiene TOPE: sin él, cualquiera con una cuenta podía encolar importaciones
// sin fin (horas de CPU) y las alertas de los demás no llegaban nunca. Se cuenta
// en marcas, no en trabajos, porque un trabajo de 1000 marcas pesa 1000 veces
// más que uno de 1. 5000 marcas son unos 13 minutos de CPU (~155 ms cada una).
// Los controladores preguntan hayLugarEnCola ANTES de insertar: si no hay
// lugar, responden 503 y no quedan marcas guardadas sin alertas.
//
// Vive en memoria: si el servidor se reinicia a mitad de camino, esas alertas no
// se generan. `npm run recalcular-alertas` las recupera (compara cada boletín
// contra todas las marcas).
//
// Tope POR USUARIO (tercera revisión de Case, M4): con solo el tope global, una
// cuenta llenaba las 5000 plazas con 5 importaciones y todos los demás recibían
// 503 durante ~13 minutos. Con 1000 por usuario (lo que entra en una
// importación), una cuenta usa como mucho un 20% de la fila: tiene que esperar
// a que terminen sus alertas antes de importar de nuevo.
export const MAX_MARCAS_EN_COLA = 5000
export const MAX_MARCAS_EN_COLA_POR_USUARIO = 1000
let cola = Promise.resolve()
let marcasEnCola = 0
const marcasEnColaPorUsuario = new Map() // userId -> marcas pendientes

// ¿Entran `cantidad` marcas más de este usuario? Devuelve null si entran, o el
// motivo: 'usuario' (sus propias alertas todavía se están generando) o
// 'servidor' (la fila está llena con las de todos).
export function faltaLugarEnCola(userId, cantidad) {
    if ((marcasEnColaPorUsuario.get(userId) ?? 0) + cantidad > MAX_MARCAS_EN_COLA_POR_USUARIO) return 'usuario'
    if (marcasEnCola + cantidad > MAX_MARCAS_EN_COLA) return 'servidor'
    return null
}

function sumarEnCola(userId, cantidad) {
    marcasEnCola += cantidad
    const nuevo = (marcasEnColaPorUsuario.get(userId) ?? 0) + cantidad
    // Al llegar a 0 se borra la entrada: el Map no crece con cada usuario que pasó.
    if (nuevo > 0) marcasEnColaPorUsuario.set(userId, nuevo)
    else marcasEnColaPorUsuario.delete(userId)
}

// Reserva lugar en la fila ANTES de insertar (tercera revisión de Case, B3).
// Antes se preguntaba faltaLugarEnCola, después había await (COUNT, INSERT) y
// recién al final se sumaba: varias importaciones en paralelo pasaban todas el
// chequeo y se pasaban del tope. Revisar y reservar en el mismo paso, sin await
// en el medio, no deja carrera (Node corre este código de a un pedido por vez).
//
// Devuelve { falta } si no hay lugar ('usuario' | 'servidor'). Si hay, devuelve
// { falta: null, encolar, liberar }:
// - encolar(db, ids, opciones): encola lo que efectivamente se insertó y devuelve
//   lo que sobró de la reserva (por ejemplo, marcas duplicadas que no entraron).
//   opciones = { regenerar } (ver generarAlertasParaMarcas);
// - liberar(): devuelve toda la reserva, si algo falló antes de encolar.
// Usar una sola de las dos, una sola vez.
export function reservarLugarEnCola(userId, cantidad) {
    const falta = faltaLugarEnCola(userId, cantidad)
    if (falta) return { falta }
    sumarEnCola(userId, cantidad)
    let usada = false
    return {
        falta: null,
        encolar(db, marcaIds, opciones) {
            if (usada) return
            usada = true
            sumarEnCola(userId, -(cantidad - marcaIds.length))
            return encolarReservado(db, marcaIds, userId, opciones)
        },
        liberar() {
            if (usada) return
            usada = true
            sumarEnCola(userId, -cantidad)
        },
    }
}

// Encola sin chequear el tope (lo usan los tests y la reserva de arriba).
export function encolarAlertasParaMarcas(db, marcaIds, userId) {
    sumarEnCola(userId, marcaIds.length)
    return encolarReservado(db, marcaIds, userId)
}

// El lugar ya está sumado en los contadores: acá solo se encola el trabajo y,
// al terminar, se descuenta.
function encolarReservado(db, marcaIds, userId, opciones) {
    const cantidad = marcaIds.length
    if (cantidad === 0) return cola
    cola = cola
        .then(async () => {
            const inicio = performance.now()
            const nuevas = await generarAlertasParaMarcas(db, marcaIds, opciones)
            console.log(`Alertas: ${cantidad} marcas procesadas, ${nuevas} alertas nuevas, ${Math.round(performance.now() - inicio)} ms`)
        })
        .catch((err) => registrarError('Generación de alertas', err))
        // finally: se descuenta tanto si el trabajo salió bien como si falló.
        .finally(() => sumarEnCola(userId, -cantidad))
    return cola
}
