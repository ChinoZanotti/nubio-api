import { tokens, quitarGenericos } from './normalizar.js'
import { claveEspanol, claveGuarani } from './fonetica.js'
import { simRatio } from './metricas.js'
import { relacionClase } from './clasesRelacionadas.js'

// Por debajo de este puntaje no se genera alerta.
export const UMBRAL_ALERTA = 70
const UMBRAL_ALTA = 85
// Con un parecido así de fuerte no castigamos por clase: podría ser una marca
// notoria, protegida en cualquier clase (Ley 1294/98, art. 2 inc. g).
const SIN_PENALIDAD_CLASE = 95
const AJUSTE_CLASE = { misma: 5, relacionada: 0, otra: -15 }

const LARGO_MINIMO_TOKEN = 3

// Parecido fonético: la mejor de las dos lecturas (español o guaraní).
function simFonetica(a, b) {
    return Math.max(
        simRatio(claveEspanol(a), claveEspanol(b)),
        simRatio(claveGuarani(a), claveGuarani(b)),
    )
}

const simPalabra = (a, b) => Math.max(simRatio(a, b), simFonetica(a, b))

// Qué parte de la marca "origen" aparece (parecida) en la marca "destino".
// Para cada palabra del origen buscamos la más parecida del destino y
// promediamos, pesando por largo. Así:
//   "NUBIO" vs "NUBIO CAFE"       -> 1.0 (toda mi marca está en la otra)
//   "CAFE NUBIO" vs "CAFE TORRES" -> ~0.7 (solo coincide la mitad)
function cobertura(origen, destino) {
    const palabras = origen.filter((t) => t.length >= LARGO_MINIMO_TOKEN)
    const candidatas = destino.filter((t) => t.length >= LARGO_MINIMO_TOKEN)
    if (!palabras.length || !candidatas.length) return 0
    let suma = 0
    let pesos = 0
    for (const p of palabras) {
        const mejor = Math.max(...candidatas.map((c) => simPalabra(p, c)))
        suma += mejor * p.length
        pesos += p.length
    }
    return suma / pesos
}

// 1 si una marca está contenida entera, como palabras completas, en la otra.
function contencion(a, b) {
    const [corta, larga] = a.length <= b.length ? [a, b] : [b, a]
    if (corta.length < LARGO_MINIMO_TOKEN) return 0
    return ` ${larga} `.includes(` ${corta} `) ? 1 : 0
}

// Compara una marca propia con una del boletín. Cada una es { denominacion, clase_niza }.
// Devuelve { score (0-100), nivel ('alta' | 'media' | null), motivos, relacionClase }.
export function compararMarcas(mia, ajena) {
    const relacion = relacionClase(mia.clase_niza, ajena.clase_niza)
    const ta = quitarGenericos(tokens(mia.denominacion))
    const tb = quitarGenericos(tokens(ajena.denominacion))
    if (!ta.length || !tb.length) {
        return { score: 0, nivel: null, motivos: [], relacionClase: relacion }
    }

    const a = ta.join(' ')
    const b = tb.join(' ')
    const orto = simRatio(a, b)
    const fon = simFonetica(a, b)
    const palabra = Math.max(cobertura(ta, tb), cobertura(tb, ta))
    const cont = contencion(a, b)

    // Nos quedamos con la señal más fuerte. Las de palabra y contención se
    // descuentan un poco porque comparan una parte, no la marca entera.
    const base = Math.round(100 * Math.max(0.55 * orto + 0.45 * fon, palabra * 0.95, cont * 0.9))

    let ajuste = AJUSTE_CLASE[relacion]
    if (ajuste < 0 && base >= SIN_PENALIDAD_CLASE) ajuste = 0
    const score = Math.max(0, Math.min(100, base + ajuste))

    const motivos = []
    if (fon >= 0.85) motivos.push('Fonética')
    if (orto >= 0.85) motivos.push('Ortográfica')
    if (palabra >= 0.88) motivos.push('Palabra clave')
    if (cont === 1) motivos.push('Contención')
    if (relacion === 'misma') motivos.push('Misma clase')
    if (relacion === 'relacionada') motivos.push('Clase relacionada')

    const nivel = score >= UMBRAL_ALTA ? 'alta' : score >= UMBRAL_ALERTA ? 'media' : null
    return { score, nivel, motivos, relacionClase: relacion }
}
