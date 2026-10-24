// Feriados nacionales de Paraguay, para calcular días hábiles.
//
// Los fijos y la Semana Santa se calculan solos. Algunos feriados (1 de marzo,
// 12 de junio, 29 de setiembre) se trasladan a lunes por decreto según el año:
// PENDIENTE cargar esos traslados en AJUSTES cada año, desde el decreto oficial.
// También sirve para sumar asuetos o días inhábiles de DINAPI.

const FIJOS = [
    '01-01', // Año Nuevo
    '03-01', // Día de los Héroes
    '05-01', // Día del Trabajador
    '05-14', '05-15', // Independencia
    '06-12', // Paz del Chaco
    '08-15', // Fundación de Asunción
    '09-29', // Victoria de Boquerón
    '12-08', // Virgen de Caacupé
    '12-25', // Navidad
]

// Ej: { 2026: { agregar: ['2026-06-15'], quitar: ['2026-06-12'] } }
const AJUSTES = {}

// Domingo de Pascua (algoritmo de Meeus/Jones/Butcher para el calendario gregoriano).
export function domingoDePascua(anio) {
    const a = anio % 19
    const b = Math.floor(anio / 100)
    const c = anio % 100
    const d = Math.floor(b / 4)
    const e = b % 4
    const f = Math.floor((b + 8) / 25)
    const g = Math.floor((b - f + 1) / 3)
    const h = (19 * a + b - d - g + 15) % 30
    const i = Math.floor(c / 4)
    const k = c % 4
    const l = (32 + 2 * e + 2 * i - h - k) % 7
    const m = Math.floor((a + 11 * h + 22 * l) / 451)
    const mes = Math.floor((h + l - 7 * m + 114) / 31)
    const dia = ((h + l - 7 * m + 114) % 31) + 1
    return new Date(Date.UTC(anio, mes - 1, dia))
}

function menosDias(fecha, dias) {
    const d = new Date(fecha)
    d.setUTCDate(d.getUTCDate() - dias)
    return d.toISOString().slice(0, 10)
}

const cache = new Map()

function feriadosDelAnio(anio) {
    if (!cache.has(anio)) {
        const pascua = domingoDePascua(anio)
        const lista = new Set(FIJOS.map((md) => `${anio}-${md}`))
        lista.add(menosDias(pascua, 3)) // Jueves Santo
        lista.add(menosDias(pascua, 2)) // Viernes Santo
        for (const f of AJUSTES[anio]?.quitar ?? []) lista.delete(f)
        for (const f of AJUSTES[anio]?.agregar ?? []) lista.add(f)
        cache.set(anio, lista)
    }
    return cache.get(anio)
}

// fecha: "aaaa-mm-dd"
export function esFeriado(fecha) {
    return feriadosDelAnio(Number(fecha.slice(0, 4))).has(fecha)
}
