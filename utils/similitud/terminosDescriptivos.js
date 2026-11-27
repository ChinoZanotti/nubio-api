// Palabras DESCRIPTIVAS por clase Niza: describen el producto o servicio de
// esa clase (CAFE en la 30) y por eso no distinguen una marca de otra DENTRO
// de esa clase.
//
// Regla, confirmada por la abogada (noviembre 2026):
// - Si lo único en común entre dos marcas es una palabra descriptiva, no hay
//   alerta: CAFE NUBIO contra CAFE TORRES, en la clase 30, "no merece alerta".
// - Si además coincide algo distintivo, la alerta sigue: NUBIO contra NUBIO
//   CAFE es "con más razón oponible".
// Se logra sacando estas palabras al preparar cada marca, con la clase DE ESA
// marca (ver quitarGenericos en normalizar.js). Lo que queda es lo distintivo.
//
// Solo entran palabras APROBADAS por la abogada: una palabra de más esconde
// alertas reales. No sirve armar la lista por frecuencia en los boletines: las
// palabras más repetidas de una clase mezclan descriptivas (MIEL, YERBA) con
// marcas que un mismo solicitante publicó muchas veces (GLORIA, CAVALLARO).
// La propuesta para que la revise está en el documento de reglas, en Google
// Docs y compartido con ella ("Cómo compara Nubio las marcas", sección
// "Propuesta: palabras descriptivas por clase"). Sumar acá solo lo que apruebe.
//
// Van normalizadas: mayúsculas, sin acentos ni puntos (como las deja normalizar).
const POR_CLASE = {
    30: ['CAFE'],
}

export const TERMINOS_DESCRIPTIVOS = new Map(
    Object.entries(POR_CLASE).map(([clase, palabras]) => [Number(clase), new Set(palabras)]),
)

// ¿`palabra` es descriptiva en `clase`? Sin clase (o clase sin lista), no.
export function esDescriptiva(palabra, clase) {
    return TERMINOS_DESCRIPTIVOS.get(Number(clase))?.has(palabra) ?? false
}
