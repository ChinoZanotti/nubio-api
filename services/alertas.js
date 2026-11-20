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
        const insertadas = await db('alertas')
            .insert(filas.slice(i, i + TANDA_INSERT))
            .onConflict(['marca_id', 'boletin_marca_id'])
            .ignore()
            .returning('id')
        total += insertadas.length
    }
    return total
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
export async function generarAlertasParaMarcas(db, marcaIds) {
    if (marcaIds.length === 0) return 0
    const marcas = await db('marcas').select(COLUMNAS_MARCA).whereIn('id', marcaIds)
    const { publicadas, preparadas } = await publicadasEnPlazo(db)
    return insertar(db, await generarPares(marcas, publicadas, preparadas))
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
// - encolar(db, ids): encola lo que efectivamente se insertó y devuelve lo que
//   sobró de la reserva (por ejemplo, marcas duplicadas que no entraron);
// - liberar(): devuelve toda la reserva, si algo falló antes de encolar.
// Usar una sola de las dos, una sola vez.
export function reservarLugarEnCola(userId, cantidad) {
    const falta = faltaLugarEnCola(userId, cantidad)
    if (falta) return { falta }
    sumarEnCola(userId, cantidad)
    let usada = false
    return {
        falta: null,
        encolar(db, marcaIds) {
            if (usada) return
            usada = true
            sumarEnCola(userId, -(cantidad - marcaIds.length))
            return encolarReservado(db, marcaIds, userId)
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
function encolarReservado(db, marcaIds, userId) {
    const cantidad = marcaIds.length
    if (cantidad === 0) return cola
    cola = cola
        .then(async () => {
            const inicio = performance.now()
            const nuevas = await generarAlertasParaMarcas(db, marcaIds)
            console.log(`Alertas: ${cantidad} marcas procesadas, ${nuevas} alertas nuevas, ${Math.round(performance.now() - inicio)} ms`)
        })
        .catch((err) => registrarError('Generación de alertas', err))
        // finally: se descuenta tanto si el trabajo salió bien como si falló.
        .finally(() => sumarEnCola(userId, -cantidad))
    return cola
}
