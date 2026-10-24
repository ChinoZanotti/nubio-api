import { TERMINOS_GENERICOS } from './terminosGenericos.js'

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

// Saca las palabras que no distinguen una marca de otra ("S.A.", "PARAGUAY", "DE"...).
// Si la marca es solo palabras genéricas, la devolvemos entera: algo hay que comparar.
export function quitarGenericos(lista) {
    const distintivos = lista.filter((t) => !TERMINOS_GENERICOS.has(t))
    return distintivos.length > 0 ? distintivos : lista
}
