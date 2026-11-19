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
// Por debajo de esto dos palabras no "coinciden": ARSIS y BARRIOS se parecen
// 0.68 en letras, pero nadie las confundiría.
const PISO_PALABRA = 0.75

// Deja una marca lista para comparar: normalizada, sin genéricos y con sus claves
// fonéticas (de la marca entera y de cada palabra).
//
// Por qué existe: normalizar y sacar las claves fonéticas cuesta decenas de
// expresiones regulares por marca. Antes se hacía dentro de cada comparación,
// así que con 1000 marcas propias cada marca del boletín se volvía a procesar
// 1000 veces, siempre con el mismo resultado. Ahora se prepara una vez y se
// compara muchas.
export function prepararMarca(marca) {
    const lista = quitarGenericos(tokens(marca.denominacion))
    const texto = lista.join(' ')
    return {
        clase_niza: marca.clase_niza,
        texto,
        esp: claveEspanol(texto),
        gua: claveGuarani(texto),
        // Solo las palabras que cuentan para la cobertura (las muy cortas no).
        palabras: lista
            .filter((t) => t.length >= LARGO_MINIMO_TOKEN)
            .map((t) => ({ texto: t, esp: claveEspanol(t), gua: claveGuarani(t) })),
    }
}

// Parecido fonético: la mejor de las dos lecturas (español o guaraní).
// Recibe dos cosas con { esp, gua } ya calculados (marcas o palabras preparadas).
function simFonetica(a, b) {
    return Math.max(simRatio(a.esp, b.esp), simRatio(a.gua, b.gua))
}

const simPalabra = (a, b) => Math.max(simRatio(a.texto, b.texto), simFonetica(a, b))

// Qué parte de la marca "origen" aparece (parecida) en la marca "destino".
// Para cada palabra del origen buscamos la más parecida del destino y
// promediamos, pesando por largo. Las que no llegan al piso cuentan 0. Así:
//   "NUBIO" vs "NUBIO CAFE"       -> 1.0 (toda mi marca está en la otra)
//   "CAFE NUBIO" vs "CAFE TORRES" -> ~0.44 (solo coincide CAFE)
function cobertura(palabras, candidatas) {
    if (!palabras.length || !candidatas.length) return 0
    let suma = 0
    let pesos = 0
    for (const p of palabras) {
        let mejor = 0
        for (const c of candidatas) mejor = Math.max(mejor, simPalabra(p, c))
        if (mejor >= PISO_PALABRA) suma += mejor * p.texto.length
        pesos += p.texto.length
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
// Cómoda para comparar un par suelto (y en los tests). Para comparar muchas
// contra muchas, preparar cada una una vez y usar compararPreparadas.
export function compararMarcas(mia, ajena) {
    return compararPreparadas(prepararMarca(mia), prepararMarca(ajena))
}

// Igual que compararMarcas, pero con marcas que ya pasaron por prepararMarca.
export function compararPreparadas(mia, ajena) {
    const relacion = relacionClase(mia.clase_niza, ajena.clase_niza)
    if (!mia.texto || !ajena.texto) {
        return { score: 0, nivel: null, motivos: [], relacionClase: relacion }
    }

    const a = mia.texto
    const b = ajena.texto
    const orto = simRatio(a, b)
    const fon = simFonetica(mia, ajena)
    const palabra = Math.max(cobertura(mia.palabras, ajena.palabras), cobertura(ajena.palabras, mia.palabras))
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
