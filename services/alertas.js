import { compararMarcas, UMBRAL_ALERTA } from '../utils/similitud/index.js'
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

function generarPares(marcas, publicadas) {
    const filas = []
    for (const marca of marcas) {
        for (const publicada of publicadas) {
            if (!esComparable(marca, publicada)) continue
            const r = compararMarcas(marca, publicada)
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

// Devuelve cuántas alertas nuevas se crearon. Las que ya existían se ignoran,
// así no se pisa el estado ni la nota que el usuario ya cargó.
async function insertar(db, filas) {
    if (filas.length === 0) return 0
    const insertadas = await db('alertas')
        .insert(filas)
        .onConflict(['marca_id', 'boletin_marca_id'])
        .ignore()
        .returning('id')
    return insertadas.length
}

// Un boletín nuevo se compara contra las marcas de TODOS los usuarios.
export async function generarAlertasParaBoletin(db, fechaPublicacion) {
    const publicadas = await db('boletin_marcas').select(COLUMNAS_BOLETIN).where({ fecha_publicacion: fechaPublicacion })
    const marcas = await db('marcas').select(COLUMNAS_MARCA)
    return insertar(db, generarPares(marcas, publicadas))
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
    return insertar(db, generarPares(marcas, publicadas))
}
