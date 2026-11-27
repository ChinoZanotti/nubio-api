import { TERMINOS_GENERICOS } from './terminosGenericos.js'
import { esDescriptiva } from './terminosDescriptivos.js'

// Deja una denominación lista para comparar: mayúsculas, sin acentos, sin tildes
// nasales del guaraní (ỹ, g̃), sin puso (') y sin puntuación. La Ñ se conserva
// porque es una letra distinta, no una N con acento.
export function normalizar(texto) {
    return String(texto ?? '')
        .toUpperCase()
        .normalize('NFD') // separa la letra de su tilde: "É" -> "E" + "´"
        .replace(/Ñ/g, 'Ñ') // volvemos a juntar la Ñ antes de borrar tildes
        .replace(/\p{Diacritic}/gu, '')
        .replace(/['’`´]/g, '') // puso guaraní: "KA'A" -> "KAA"
        .replace(/\./g, '') // "S.A." -> "SA", así la reconocemos como genérica
        .replace(/&/g, ' Y ')
        .replace(/[^A-ZÑ0-9]+/g, ' ')
        .trim()
}

export function tokens(texto) {
    const normalizado = normalizar(texto)
    return normalizado ? normalizado.split(' ') : []
}

// Saca las palabras que no distinguen una marca de otra: las genéricas ("S.A.",
// "PARAGUAY", "DE"...) y, si se pasa la clase, las descriptivas de ESA clase
// (CAFE en la 30, ver terminosDescriptivos.js).
// Si no queda nada, se va aflojando: primero sin las descriptivas ("EL CAFE"
// en la 30 queda "CAFE") y, si tampoco, la marca entera. Algo hay que comparar.
export function quitarGenericos(lista, clase) {
    const sinGenericos = lista.filter((t) => !TERMINOS_GENERICOS.has(t))
    const distintivos = sinGenericos.filter((t) => !esDescriptiva(t, clase))
    if (distintivos.length > 0) return distintivos
    return sinGenericos.length > 0 ? sinGenericos : lista
}

// Formas societarias escritas de varias maneras, llevadas a una sola. Se
// UNIFICAN, no se borran: "Gloria S.A." y "Gloria Inc." son sociedades
// distintas (revisión de Case del motor, A1). Van ya normalizadas (los puntos
// ya se fueron: "S. A." llega como "S A").
const FORMAS_SOCIETARIAS = [
    [/\bSOCIEDAD ANONIMA\b/g, 'SA'],
    [/\bSOCIEDAD DE RESPONSABILIDAD LIMITADA\b/g, 'SRL'],
    [/\bS A\b/g, 'SA'],
    [/\bS R L\b/g, 'SRL'],
    [/\bLIMITED\b/g, 'LTD'],
    [/\bLIMITADA\b/g, 'LTDA'],
    [/\bINCORPORATED\b/g, 'INC'],
    [/\bCORPORATION\b/g, 'CORP'],
]
const SOLO_FORMA = new Set(['SA', 'SRL', 'LTD', 'LTDA', 'INC', 'CORP', 'LLC', 'GMBH', 'SAECA', 'SACI', 'SAIC', 'SAE', 'CIA'])

// Titular listo para comparar si dos marcas son del MISMO titular.
//
// A PROPÓSITO casi literal (revisión de Case del motor, A1): se ignoran solo
// mayúsculas, acentos, puntuación y espacios, y se unifican las formas
// societarias ("Nubio S.A." = "NUBIO SA" = "Nubio Sociedad Anónima"). NO se
// borran la forma societaria, los conectores ni las palabras repetidas, y NO
// se cambia el orden: cada una de esas cosas hacía iguales a titulares
// distintos ("Gloria S.A." = "Gloria Inc."; "María de los Ángeles Benítez" =
// "María Ángeles Benítez"), y eso escondía alertas reales. Medido con la
// cartera del estudio: los 37 pares del mismo titular tenían el titular escrito
// igual; la normalización agresiva no sumaba ninguno.
// '' si no hay titular o es solo una forma societaria (nunca coincide).
export function normalizarTitular(texto) {
    let t = normalizar(texto)
    for (const [patron, forma] of FORMAS_SOCIETARIAS) t = t.replace(patron, forma)
    const palabras = t.split(' ').filter(Boolean)
    return palabras.every((p) => SOLO_FORMA.has(p)) ? '' : palabras.join(' ')
}
