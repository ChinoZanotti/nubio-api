import { compararPreparadas, prepararMarca, UMBRAL_ALERTA } from '../utils/similitud/index.js'
import { hoy, venceOposicion } from '../utils/plazos.js'

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

async function generarPares(marcas, publicadas) {
    // El chequeo es síncrono y el await va solo cuando toca ceder: un await en
    // cada par (millones) sumaría segundos de espera inútil.
    let inicioTramo = performance.now()
    const tramoCumplido = () => performance.now() - inicioTramo > TRAMO_MS
    async function ceder() {
        await cederTurno()
        inicioTramo = performance.now()
    }

    // Cada marca del boletín se prepara (normaliza + claves fonéticas) UNA vez,
    // no en cada par. Son miles: también se cede el turno mientras se preparan.
    const preparadas = new Map()
    for (const publicada of publicadas) {
        if (tramoCumplido()) await ceder()
        preparadas.set(publicada, prepararMarca(publicada))
    }

    const filas = []
    for (const marca of marcas) {
        const mia = prepararMarca(marca)
        for (const publicada of publicadas) {
            if (tramoCumplido()) await ceder()
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

// Una marca nueva de un usuario se compara solo contra lo publicado que todavía
// se puede oponer: lo que ya venció no es accionable.
export async function generarAlertasParaMarcas(db, marcaIds) {
    if (marcaIds.length === 0) return 0
    const marcas = await db('marcas').select(COLUMNAS_MARCA).whereIn('id', marcaIds)
    const desde = new Date(Date.now() - DIAS_CORRIDOS_PREFILTRO * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const hoyPy = hoy()
    const publicadas = (await db('boletin_marcas').select(COLUMNAS_BOLETIN).where('fecha_publicacion', '>=', desde))
        .filter((p) => venceOposicion(p.fecha_publicacion) >= hoyPy)
    return insertar(db, await generarPares(marcas, publicadas))
}

// Fila de trabajos en segundo plano: las generaciones encoladas corren de a UNA.
// Si llegan diez importaciones juntas, no compiten por la CPU: esperan su turno.
// `cola` es siempre la promesa del último trabajo; cada uno nuevo se engancha atrás.
//
// Vive en memoria: si el servidor se reinicia a mitad de camino, esas alertas no
// se generan. `npm run recalcular-alertas` las recupera (compara cada boletín
// contra todas las marcas).
let cola = Promise.resolve()

export function encolarAlertasParaMarcas(db, marcaIds) {
    cola = cola
        .then(async () => {
            const inicio = performance.now()
            const nuevas = await generarAlertasParaMarcas(db, marcaIds)
            console.log(`Alertas: ${marcaIds.length} marcas procesadas, ${nuevas} alertas nuevas, ${Math.round(performance.now() - inicio)} ms`)
        })
        .catch((err) => console.error('No se pudieron generar alertas:', err))
    return cola
}
