import { esFeriado } from './feriados.js'

// Plazo de oposición: 60 días hábiles contados desde el primer día hábil
// siguiente a la última publicación (Ley 1294/98, art. 46).
// OJO: la ley cuenta desde la última publicación en el diario, que no tenemos.
// Usamos la fecha del boletín DINAPI, así que el vencimiento es ESTIMADO.
export const DIAS_OPOSICION = 60

// Trabajamos todo en UTC con strings "aaaa-mm-dd" para que la zona horaria
// del servidor no corra las fechas un día.
const aFecha = (texto) => new Date(`${texto}T00:00:00Z`)
const aTexto = (fecha) => fecha.toISOString().slice(0, 10)

export function hoy() {
    // Fecha de hoy en Paraguay, no la del servidor (Render corre en UTC).
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Asuncion' })
}

export function esDiaHabil(texto) {
    const dia = aFecha(texto).getUTCDay()
    return dia !== 0 && dia !== 6 && !esFeriado(texto)
}

// Suma n días hábiles. No cuenta el día de partida: arranca al día siguiente.
export function sumarDiasHabiles(texto, n) {
    const fecha = aFecha(texto)
    let restantes = n
    while (restantes > 0) {
        fecha.setUTCDate(fecha.getUTCDate() + 1)
        if (esDiaHabil(aTexto(fecha))) restantes--
    }
    return aTexto(fecha)
}

// Días hábiles después de `desde` y hasta `hasta` inclusive.
// Negativo si `hasta` ya pasó (cuántos días hábiles hace que venció).
export function diasHabilesEntre(desde, hasta) {
    if (hasta < desde) return -diasHabilesEntre(hasta, desde)
    const fecha = aFecha(desde)
    let dias = 0
    while (aTexto(fecha) < hasta) {
        fecha.setUTCDate(fecha.getUTCDate() + 1)
        if (esDiaHabil(aTexto(fecha))) dias++
    }
    return dias
}

export function venceOposicion(fechaPublicacion) {
    return sumarDiasHabiles(fechaPublicacion, DIAS_OPOSICION)
}
