// Cuotas de las cuentas (panel comercial, etapa 4): los períodos que cubre cada
// pago y el estado de la cuota (al día, por vencer, vencida).
//
// IMPORTANTE: es COPIA de nubio/panel/cuotas.js (como cuentaValidation.js): el
// panel la usa para mostrar "Va a quedar pagado hasta…" mientras se completa
// el formulario. Si cambia una regla, cambiarla en los dos. La que manda es
// esta: el servidor recalcula todo al guardar.
//
// Reglas (decisiones de Carlos, 27/11/2026):
// - Se paga por adelantado y cada pago cubre un período: 1 mes, o 12 si la
//   modalidad es anual. `hasta` es el día en que vence la cuota siguiente.
// - Los meses se cuentan con el DÍA DE PAGO de la cuenta, no sumando 30 días:
//   un pago desde el 10/11 cubre hasta el 10/12. En los meses más cortos, el
//   último día (día de pago 31: 31/1 → 28/2 → 31/3, sin correrse).
// - Si `desde` cae en otro día (el período nuevo empieza al reactivar una
//   cuenta suspendida, o se cambió a mano), ese pasa a ser el día de pago.
// - Fechas como texto 'aaaa-mm-dd' (DATE de Postgres, ver db.js), en hora de
//   Paraguay: "hoy" es el día en Asunción, no en el servidor.

export const UMBRAL_POR_VENCER = { mensual: 7, automatica_mensual: 7, anual: 30 }
export const mesesDelPeriodo = (modalidad) => (modalidad === 'anual' ? 12 : 1)

export const hoyEnParaguay = (ahora = new Date()) => ahora.toLocaleDateString('en-CA', { timeZone: 'America/Asuncion' })

const partes = (iso) => iso.split('-').map(Number)
const diasDelMes = (anio, mes) => new Date(Date.UTC(anio, mes, 0)).getUTCDate() // mes de 1 a 12
const aIso = (anio, mes, dia) => `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`

export function fechaValida(iso) {
    if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false
    const [a, m, d] = partes(iso)
    return m >= 1 && m <= 12 && d >= 1 && d <= diasDelMes(a, m)
}

// `meses` después de `iso`, en el día `dia` (o el último del mes si no tiene)
export function sumarMeses(iso, meses, dia) {
    const [a, m] = partes(iso)
    const total = (m - 1) + meses
    const anio = a + Math.floor(total / 12)
    const mes = (total % 12) + 1
    return aIso(anio, mes, Math.min(dia, diasDelMes(anio, mes)))
}

// El día anterior: el último que cubre un pago (`hasta` es el día en que vence
// la cuota siguiente). 2026-12-10 → 2026-12-09
export function diaAnterior(iso) {
    const [a, m, d] = partes(iso)
    const fecha = new Date(Date.UTC(a, m - 1, d - 1))
    return aIso(fecha.getUTCFullYear(), fecha.getUTCMonth() + 1, fecha.getUTCDate())
}

// Días de `desde` a `hasta` (negativo si `hasta` ya pasó)
export function diasEntre(desde, hasta) {
    const [a1, m1, d1] = partes(desde)
    const [a2, m2, d2] = partes(hasta)
    return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86_400_000)
}

// El período de un pago que empieza en `desde`. Devuelve { hasta, diaPago }:
// diaPago es el día de pago que corresponde desde ahora (el de la cuenta, o el
// de `desde` si cae en otro día; un 28/2 con día de pago 31 NO lo cambia).
export function calcularPeriodo(desde, modalidad, diaPago) {
    const [a, m, d] = partes(desde)
    const elQueToca = Math.min(diaPago, diasDelMes(a, m))
    const dia = elQueToca === d ? diaPago : d
    return { hasta: sumarMeses(desde, mesesDelPeriodo(modalidad), dia), diaPago: dia }
}

// Desde cuándo corre el pago siguiente (lo que propone el formulario):
// - sin pagos: la fecha de ingreso;
// - suspendida: hoy (el período nuevo empieza al reactivar; si se reactiva
//   otro día, se cambia a mano);
// - reactivada DESPUÉS de que venció lo pagado: el día de la reactivación
//   (el tiempo suspendido no cuenta como cuota);
// - si no: sigue desde lo pagado, aunque esté atrasada (mientras está activa,
//   la cuota corre; no cambia su día de pago).
export function proximoDesde({ pagadoHasta, fechaIngreso, suspendida, reactivadaEl }, hoy) {
    if (suspendida) return hoy
    if (!pagadoHasta) return fechaIngreso ?? hoy
    if (reactivadaEl && reactivadaEl > pagadoHasta) return reactivadaEl
    return pagadoHasta
}

// El estado de la cuota: { estado, dias }, con dias = días hasta que vence
// (negativo: hace cuánto venció).
//   'sin_pagos': nunca se registró un pago (las cuentas de antes del panel);
//   'suspendida': la cuota no corre mientras está suspendida;
//   'vencida': ya pasó el día de vencimiento;
//   'por_vencer': vence en 7 días o menos (30 si es anual), o vence hoy;
//   'al_dia'.
export function estadoCuota({ pagadoHasta, modalidad, suspendida }, hoy) {
    if (!pagadoHasta) return { estado: 'sin_pagos', dias: null }
    const dias = diasEntre(hoy, pagadoHasta)
    if (suspendida) return { estado: 'suspendida', dias }
    if (dias < 0) return { estado: 'vencida', dias }
    if (dias <= (UMBRAL_POR_VENCER[modalidad] ?? 7)) return { estado: 'por_vencer', dias }
    return { estado: 'al_dia', dias }
}
