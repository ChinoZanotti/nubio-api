import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sumarMeses, diasEntre, diaAnterior, calcularPeriodo, proximoDesde, estadoCuota, fechaValida, hoyEnParaguay } from '../utils/cuotas.js'

test('los meses se cuentan con el día de pago, sin correrse en los meses cortos', () => {
    assert.equal(sumarMeses('2026-11-10', 1, 10), '2026-12-10')
    assert.equal(sumarMeses('2026-12-10', 1, 10), '2027-01-10')
    assert.equal(sumarMeses('2027-01-31', 1, 31), '2027-02-28')
    assert.equal(sumarMeses('2027-02-28', 1, 31), '2027-03-31')
    assert.equal(sumarMeses('2028-01-31', 1, 31), '2028-02-29') // bisiesto
    assert.equal(sumarMeses('2026-11-10', 12, 10), '2027-11-10')
})

test('el período de un pago: mensual, anual y el día de pago que corresponde', () => {
    assert.deepEqual(calcularPeriodo('2026-11-10', 'mensual', 10), { hasta: '2026-12-10', diaPago: 10 })
    assert.deepEqual(calcularPeriodo('2026-11-10', 'anual', 10), { hasta: '2027-11-10', diaPago: 10 })
    // 28/2 con día de pago 31 es "el último día": no cambia el día de pago
    assert.deepEqual(calcularPeriodo('2027-02-28', 'mensual', 31), { hasta: '2027-03-31', diaPago: 31 })
    // Reactivada el 20: el período corre desde el 20 y ese pasa a ser el día de pago
    assert.deepEqual(calcularPeriodo('2026-12-20', 'mensual', 10), { hasta: '2027-01-20', diaPago: 20 })
})

test('desde cuándo corre el pago siguiente', () => {
    const hoy = '2026-12-15'
    assert.equal(proximoDesde({ fechaIngreso: '2026-11-10' }, hoy), '2026-11-10', 'sin pagos: la fecha de ingreso')
    assert.equal(proximoDesde({ pagadoHasta: '2026-12-10' }, hoy), '2026-12-10', 'atrasada sin suspensión: sigue desde lo pagado')
    assert.equal(proximoDesde({ pagadoHasta: '2026-12-10', suspendida: true }, hoy), hoy, 'suspendida: hoy')
    assert.equal(proximoDesde({ pagadoHasta: '2026-12-10', reactivadaEl: '2026-12-14' }, hoy), '2026-12-14', 'reactivada después del vencimiento: desde la reactivación')
    assert.equal(proximoDesde({ pagadoHasta: '2026-12-10', reactivadaEl: '2026-12-01' }, hoy), '2026-12-10', 'reactivada antes del vencimiento: sigue desde lo pagado')
})

test('el estado de la cuota', () => {
    const hoy = '2026-12-01'
    assert.deepEqual(estadoCuota({}, hoy), { estado: 'sin_pagos', dias: null })
    assert.equal(estadoCuota({ pagadoHasta: '2026-12-20', modalidad: 'mensual' }, hoy).estado, 'al_dia')
    assert.equal(estadoCuota({ pagadoHasta: '2026-12-08', modalidad: 'mensual' }, hoy).estado, 'por_vencer') // 7 días
    assert.equal(estadoCuota({ pagadoHasta: '2026-12-09', modalidad: 'mensual' }, hoy).estado, 'al_dia') // 8 días
    assert.equal(estadoCuota({ pagadoHasta: '2026-12-01', modalidad: 'mensual' }, hoy).estado, 'por_vencer') // vence hoy
    assert.deepEqual(estadoCuota({ pagadoHasta: '2026-11-28', modalidad: 'mensual' }, hoy), { estado: 'vencida', dias: -3 })
    assert.equal(estadoCuota({ pagadoHasta: '2026-12-25', modalidad: 'anual' }, hoy).estado, 'por_vencer') // 24 días, umbral 30
    assert.equal(estadoCuota({ pagadoHasta: '2026-11-28', modalidad: 'mensual', suspendida: true }, hoy).estado, 'suspendida')
})

test('fechas y días', () => {
    assert.ok(fechaValida('2028-02-29'))
    assert.ok(!fechaValida('2027-02-29'))
    assert.ok(!fechaValida('2026-13-01'))
    assert.equal(diasEntre('2026-12-31', '2027-01-01'), 1)
    assert.equal(diaAnterior('2026-12-10'), '2026-12-09')
    assert.equal(diaAnterior('2027-01-01'), '2026-12-31')
    assert.equal(diaAnterior('2028-03-01'), '2028-02-29')
    // A las 23:30 del 31/12 en Asunción (UTC-3) ya es 1/1 en UTC
    assert.equal(hoyEnParaguay(new Date('2027-01-01T02:30:00Z')), '2026-12-31')
})
