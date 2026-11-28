import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizarCuenta, validarCuenta, normalizarTelefono, normalizarMonto, validarNota } from '../utils/cuentaValidation.js'

const valida = {
    nombre_completo: 'Ana Pérez', email: 'Ana@Estudio.com ', telefono: '0981 123 456', ruc: '80012345-6',
    razon_social: 'Pérez y Asociados', medio_pago: 'transferencia', modalidad: 'mensual',
    fecha_ingreso: '2026-11-10', dia_pago: 10, monto_mensual: '150.000',
}

test('una cuenta válida no tiene errores, y se normaliza', () => {
    const c = normalizarCuenta(valida)
    assert.deepEqual(validarCuenta(c), {})
    assert.equal(c.email, 'ana@estudio.com')
    assert.equal(c.telefono, '+595981123456')
    assert.equal(c.monto_mensual, 150000)
})

test('teléfonos como los escribe la gente en Paraguay', () => {
    assert.equal(normalizarTelefono('(0981) 123-456'), '+595981123456')
    assert.equal(normalizarTelefono('595 981 123456'), '+595981123456')
    assert.equal(normalizarTelefono('+54 9 11 1234 5678'), '+5491112345678')
    assert.equal(normalizarTelefono('0054 911 1234 5678'), '+5491112345678')
    assert.equal(normalizarTelefono('981 123 456'), '+595981123456')
})

test('montos con puntos de miles', () => {
    assert.equal(normalizarMonto('1.500.000'), 1500000)
    assert.ok(Number.isNaN(normalizarMonto('150,5')))
    assert.ok(Number.isNaN(normalizarMonto('')))
})

test('RUC y razón social son opcionales, pero si van tienen que ser válidos', () => {
    assert.deepEqual(validarCuenta(normalizarCuenta({ ...valida, ruc: '', razon_social: '' })), {})
    assert.ok(validarCuenta(normalizarCuenta({ ...valida, ruc: '80012345' })).ruc)
})

test('cada campo obligatorio dice qué falta', () => {
    const errores = validarCuenta(normalizarCuenta({}))
    for (const campo of ['nombre_completo', 'email', 'telefono', 'medio_pago', 'modalidad', 'fecha_ingreso', 'dia_pago', 'monto_mensual']) {
        assert.ok(errores[campo], campo)
    }
})

test('fechas imposibles, días fuera de rango y listas cerradas', () => {
    const e = validarCuenta(normalizarCuenta({ ...valida, fecha_ingreso: '2026-02-30', dia_pago: 32, medio_pago: 'bitcoin', modalidad: 'semanal' }))
    assert.ok(e.fecha_ingreso && e.dia_pago && e.medio_pago && e.modalidad)
})

test('el correo solo se valida en el alta', () => {
    assert.equal(validarCuenta(normalizarCuenta({ ...valida, email: '' }), { conEmail: false }).email, undefined)
})

test('las notas aceptan saltos de línea pero no caracteres invisibles', () => {
    assert.equal(validarNota('Llamar el lunes.\nPrefiere WhatsApp.'), null)
    assert.ok(validarNota('texto‮al revés'))
    assert.ok(validarNota('   '))
})
