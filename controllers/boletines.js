import { registrarError } from '../utils/log.js'

// GET /boletines/marcas: las marcas publicadas por DINAPI, de a una página.
//
// Antes devolvía la tabla entera (más de 13.000 filas, unos 3 MB) en cada
// visita, y el navegador filtraba, ordenaba y paginaba. Ahora todo eso lo
// hace la base y viajan solo las filas de la página (hallazgo N9 de Case).
//
// Parámetros (query string), todos opcionales:
//   pagina     número de página, desde 1 (default 1)
//   porPagina  filas por página, 1 a 100 (default 20)
//   orden      columna (ver ORDEN) (default fecha_publicacion)
//   direccion  asc | desc (default desc)
//   filtros    JSON: [{ campo, valor }] o, en fechas, [{ campo, desde, hasta }]
//
// Respuesta: { marcas, total, totalGeneral, opciones: { pais, tramite } }
//   total: cuántas cumplen los filtros; totalGeneral: cuántas hay en total.
//
// Todo lo que llega del cliente se valida contra listas blancas y viaja al
// SQL como parámetro (?), nunca pegado en el texto de la consulta.

const COLUMNAS = [
    'id', 'fecha_publicacion', 'expediente', 'clase_niza', 'denominacion', 'signo',
    'titular', 'pais', 'agente', 'matricula', 'tramite', 'referencia',
]

// Los mismos campos y tipos que CAMPOS_FILTRO_BOLETIN del frontend
// (src/utils/marcaFiltros.js). Si se agrega uno allá, agregarlo acá.
const FILTROS = {
    denominacion: 'texto',
    titular: 'texto',
    expediente: 'texto',
    clase_niza: 'numero',
    signo: 'opciones',
    pais: 'opciones',
    fecha_publicacion: 'fecha',
    agente: 'texto',
    matricula: 'texto',
    tramite: 'opciones',
    referencia: 'texto',
}
const MAX_FILTROS = 20
const LARGO_MAXIMO_VALOR = 200
const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/
const MAX_POR_PAGINA = 100

// Búsqueda "como lo haría una persona": sin distinguir mayúsculas ni
// tildes, igual que normalizarTexto del frontend. Postgres no saca tildes solo
// (la extensión unaccent no está activada), así que translate() cambia cada
// letra con tilde por la letra sin tilde. Las dos cadenas tienen que tener el
// mismo largo: la letra N de una se reemplaza por la letra N de la otra.
const CON_TILDE = 'áàâäãéèêëíìîïóòôöõúùûüñçÁÀÂÄÃÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇ'
const SIN_TILDE = 'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC'
// Para ORDENAR texto: la intercalación ICU del español ("es-x-icu"), la misma
// familia de reglas que usa Intl.Collator('es') en el navegador (useSort):
// sin distinguir mayúsculas ni tildes primero, y los signos de puntuación en
// el mismo lugar. Viene incluida en Postgres compilado con ICU (local y Neon);
// `npm run probar-conexion` avisa si falta. No depende de la configuración
// regional de cada base (la local de Windows es Spanish_Spain.1252).
// Única diferencia con el navegador: los números DENTRO del texto se comparan
// letra por letra ("cafe 10" antes que "cafe 9"). Igualarlo requiere crear una
// intercalación propia (locale 'es-u-kn-true') con un SQL en Neon.
const normalizada = (columna) => `${columna} collate "es-x-icu"`

// Columnas por las que se puede ordenar, con las expresiones SQL de cada una
// (un array: algunas ordenan por más de una cosa). Son fijas: no llevan nada
// del cliente.
const ORDEN = {
    denominacion: [normalizada('denominacion')],
    // Solo dígitos: primero por largo y después por texto da orden numérico
    // ("9" antes que "10") sin convertir a número.
    expediente: ['char_length(expediente)', 'expediente'],
    clase_niza: ['clase_niza'],
    titular: [normalizada('titular')],
    fecha_publicacion: ['fecha_publicacion'],
    tramite: ['tramite'],
}

// Igual que normalizarTexto del frontend: minúsculas, sin tildes, sin espacios
// en los extremos.
const normalizarTexto = (texto) => texto.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()

// En LIKE, % y _ son comodines: si el usuario busca "50%", el % tiene que ser
// un % literal, no "cualquier cosa".
const escaparLike = (texto) => texto.replace(/[\\%_]/g, (c) => `\\${c}`)

const enteroEntre = (valor, min, max, porDefecto) => {
    if (valor === undefined) return porDefecto
    const n = Number(valor)
    return Number.isInteger(n) && n >= min && n <= max ? n : null
}

// Valida los parámetros. Devuelve { consulta } o { error }.
// Exportada para los tests.
export function parsearConsulta(query) {
    const pagina = enteroEntre(query.pagina, 1, 100_000, 1)
    const porPagina = enteroEntre(query.porPagina, 1, MAX_POR_PAGINA, 20)
    if (pagina === null || porPagina === null) return { error: 'Página inválida.' }

    const orden = query.orden ?? 'fecha_publicacion'
    const direccion = query.direccion ?? 'desc'
    if (!Object.hasOwn(ORDEN, orden) || !['asc', 'desc'].includes(direccion)) {
        return { error: 'Orden inválido.' }
    }

    let filtros = []
    if (query.filtros !== undefined) {
        try {
            filtros = JSON.parse(query.filtros)
        } catch {
            return { error: 'Filtros inválidos.' }
        }
        if (!Array.isArray(filtros) || filtros.length > MAX_FILTROS) return { error: 'Filtros inválidos.' }
        for (const f of filtros) {
            const tipo = Object.hasOwn(FILTROS, f?.campo) ? FILTROS[f.campo] : null
            if (!tipo) return { error: 'Filtros inválidos.' }
            if (tipo === 'fecha') {
                for (const borde of [f.desde, f.hasta]) {
                    if (borde !== undefined && borde !== '' && !(typeof borde === 'string' && FECHA_ISO.test(borde))) {
                        return { error: 'Fecha inválida en los filtros.' }
                    }
                }
            } else if (typeof f.valor !== 'string' || f.valor.length > LARGO_MAXIMO_VALOR) {
                return { error: 'Filtros inválidos.' }
            }
        }
    }

    return { consulta: { pagina, porPagina, orden, direccion, filtros } }
}

// Agrega a la consulta un WHERE por cada filtro activo (se combinan con Y,
// como en el frontend). Un filtro vacío no filtra.
function aplicarFiltros(query, filtros) {
    for (const f of filtros) {
        const tipo = FILTROS[f.campo]
        if (tipo === 'fecha') {
            if (f.desde) query.where(f.campo, '>=', f.desde)
            if (f.hasta) query.where(f.campo, '<=', f.hasta)
            continue
        }
        const valor = f.valor.trim()
        if (!valor) continue
        if (tipo === 'texto') {
            // ?? = nombre de columna (escapado por knex), ? = valor
            query.whereRaw(
                `lower(translate(??, '${CON_TILDE}', '${SIN_TILDE}')) like ? escape '\\'`,
                [f.campo, `%${escaparLike(normalizarTexto(valor))}%`],
            )
        } else if (tipo === 'numero') {
            const n = Number(valor)
            // Un número que no es entero no coincide con nada (como en el frontend)
            if (Number.isInteger(n)) query.where(f.campo, n)
            else query.whereRaw('false')
        } else {
            query.where(f.campo, valor)
        }
    }
    return query
}

export const handleGetBoletinMarcas = async (req, res, db) => {
    const { consulta, error } = parsearConsulta(req.query)
    if (error) return res.status(400).json({ error })
    const { pagina, porPagina, orden, direccion, filtros } = consulta

    try {
        const filtrada = () => aplicarFiltros(db('boletin_marcas'), filtros)

        const [marcas, { total }, { totalGeneral }, paises, tramites] = await Promise.all([
            filtrada()
                .select(COLUMNAS)
                // Los vacíos al final en cualquier dirección (como useSort), y
                // el id desempata: sin él, dos filas iguales podrían cambiar de
                // página entre un pedido y el siguiente.
                .orderByRaw(
                    ORDEN[orden].map((expr) => `${expr} ${direccion} nulls last`).join(', ') + ', id',
                )
                .limit(porPagina)
                .offset((pagina - 1) * porPagina),
            filtrada().count('* as total').first(),
            db('boletin_marcas').count('* as totalGeneral').first(),
            // Opciones de los desplegables: los valores que existen, no todos los posibles.
            db('boletin_marcas').distinct('pais').orderBy('pais'),
            db('boletin_marcas').distinct('tramite').whereNotNull('tramite').orderBy('tramite'),
        ])

        res.json({
            marcas,
            total: Number(total),
            totalGeneral: Number(totalGeneral),
            opciones: { pais: paises.map((p) => p.pais), tramite: tramites.map((t) => t.tramite) },
        })
    } catch (err) {
        registrarError('GET /boletines/marcas', err)
        res.status(500).json({ error: 'No se pudieron obtener las marcas del boletín.' })
    }
}
