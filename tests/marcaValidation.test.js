import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    validarMarca, normalizarMarca, camposConTipoInvalido, hoyISO, LARGO_MAXIMO_DENOMINACION, LARGO_MAXIMO_TITULAR,
} from '../utils/marcaValidation.js'

const valida = {
    fecha_solicitud: '2026-01-15', expediente: '2650001', clase_niza: 30,
    denominacion: 'CAFE NUBIO', signo: 'D', titular: 'NUBIO SA', pais: 'PY',
}

test('una marca normal es válida', () => {
    assert.deepEqual(validarMarca(normalizarMarca(valida)), {})
})

test('denominación y titular en el tope exacto son válidos', () => {
    const marca = {
        ...valida,
        denominacion: 'A'.repeat(LARGO_MAXIMO_DENOMINACION),
        titular: 'B'.repeat(LARGO_MAXIMO_TITULAR),
    }
    assert.deepEqual(validarMarca(normalizarMarca(marca)), {})
})

test('denominación de un caracter más que el tope se rechaza', () => {
    const errores = validarMarca(normalizarMarca({ ...valida, denominacion: 'A'.repeat(LARGO_MAXIMO_DENOMINACION + 1) }))
    assert.match(errores.denominacion, /hasta 300 caracteres/)
})

test('titular de un caracter más que el tope se rechaza', () => {
    const errores = validarMarca(normalizarMarca({ ...valida, titular: 'B'.repeat(LARGO_MAXIMO_TITULAR + 1) }))
    assert.match(errores.titular, /hasta 500 caracteres/)
})

test('el texto enorme del ataque (900.000 letras) se rechaza', () => {
    const errores = validarMarca(normalizarMarca({ ...valida, denominacion: 'AB'.repeat(450_000) }))
    assert.ok(errores.denominacion)
})

test('una figurativa sin denominación sigue siendo válida', () => {
    assert.deepEqual(validarMarca(normalizarMarca({ ...valida, signo: 'F', denominacion: '' })), {})
})

test('expediente: hasta 20 dígitos', () => {
    assert.deepEqual(validarMarca(normalizarMarca({ ...valida, expediente: '9'.repeat(20) })), {})
    assert.match(validarMarca(normalizarMarca({ ...valida, expediente: '9'.repeat(21) })).expediente, /hasta 20 dígitos/)
    // el caso de la revisión: 100.000 dígitos
    assert.ok(validarMarca(normalizarMarca({ ...valida, expediente: '9'.repeat(100_000) })).expediente)
})

// ===== Datos del registro (sql/010_marcas_registro.sql) =====
const conRegistro = (extra) => validarMarca(normalizarMarca({ ...valida, ...extra }))

test('registro: todos los campos son opcionales', () => {
    assert.deepEqual(conRegistro({}), {})
    assert.deepEqual(conRegistro({ estado: '', numero_registro: '', fecha_registro: '', fecha_vencimiento: '' }), {})
})

test('registro: una marca concedida completa es válida (con los espacios de DINAPI)', () => {
    assert.deepEqual(conRegistro({
        estado: 'Concedida  ', numero_registro: 360461, fecha_registro: '2011-06-30', fecha_vencimiento: '2032-03-26',
    }), {})
    assert.equal(normalizarMarca({ ...valida, estado: 'Concedida  ' }).estado, 'Concedida')
})

test('registro: el número solo dígitos y hasta 20', () => {
    assert.match(conRegistro({ numero_registro: '36-0461' }).numero_registro, /solo puede tener números/)
    assert.deepEqual(conRegistro({ numero_registro: '9'.repeat(20) }), {})
    assert.match(conRegistro({ numero_registro: '9'.repeat(21) }).numero_registro, /hasta 20/)
})

test('registro: estado hasta 100 caracteres', () => {
    assert.deepEqual(conRegistro({ estado: 'x'.repeat(100) }), {})
    assert.ok(conRegistro({ estado: 'x'.repeat(101) }).estado)
})

test('registro: fechas válidas, registro no futuro, vencimiento posterior al registro', () => {
    assert.ok(conRegistro({ fecha_registro: '2026-02-31' }).fecha_registro)
    assert.match(conRegistro({ fecha_registro: '2999-01-01' }).fecha_registro, /futura/)
    assert.deepEqual(conRegistro({ fecha_vencimiento: '2036-01-15' }), {}) // vencimiento futuro: lo normal
    assert.match(conRegistro({ fecha_registro: '2020-05-10', fecha_vencimiento: '2020-05-10' }).fecha_vencimiento, /posterior/)
    assert.ok(conRegistro({ fecha_vencimiento: 'mañana' }).fecha_vencimiento)
})

test('registro: puede ser anterior a la solicitud (renovaciones)', () => {
    assert.deepEqual(conRegistro({ fecha_solicitud: '2011-07-01', fecha_registro: '2011-06-30' }), {})
})

test('registro: una marca de antes de estos campos (sin las claves) sigue siendo válida', () => {
    assert.deepEqual(validarMarca({ ...normalizarMarca(valida), estado: undefined, numero_registro: undefined,
        fecha_registro: undefined, fecha_vencimiento: undefined }), {})
})

// ===== Revisión de Case del registro =====
test('B1: objetos y listas en un campo se detectan antes de normalizar', () => {
    assert.deepEqual(camposConTipoInvalido(valida), {})
    assert.deepEqual(camposConTipoInvalido({ ...valida, estado: null, numero_registro: 412345 }), {})
    const e = camposConTipoInvalido({ ...valida, estado: {}, numero_registro: ['123'], titular: { toString: 1 } })
    assert.deepEqual(Object.keys(e).sort(), ['estado', 'numero_registro', 'titular'])
    assert.ok(camposConTipoInvalido(null).marca)
    assert.ok(camposConTipoInvalido([valida]).marca)
})

test('B2: los caracteres de control se cambian por espacios (un NUL hacía fallar el INSERT)', () => {
    const m = normalizarMarca({ ...valida, titular: 'NUBIO\u0000SA', denominacion: 'CAFE\nNUBIO', estado: '\tConcedida  ' })
    assert.equal(m.titular, 'NUBIO SA')
    assert.equal(m.denominacion, 'CAFE NUBIO')
    assert.equal(m.estado, 'Concedida')
})

test('B3: hoyISO es la fecha de Paraguay en formato aaaa-mm-dd', () => {
    assert.match(hoyISO(), /^\d{4}-\d{2}-\d{2}$/)
    assert.equal(hoyISO(), new Date().toLocaleDateString('en-CA', { timeZone: 'America/Asuncion' }))
})

test('B4: fechas fuera de rango', () => {
    assert.match(conRegistro({ fecha_solicitud: '1899-12-31' }).fecha_solicitud, /1900/)
    assert.match(conRegistro({ fecha_registro: '1899-12-31' }).fecha_registro, /1900/)
    assert.match(conRegistro({ fecha_vencimiento: '9999-12-31' }).fecha_vencimiento, /próximos 30 años/)
    const enVeinte = `${Number(hoyISO().slice(0, 4)) + 20}-01-01`
    assert.deepEqual(conRegistro({ fecha_vencimiento: enVeinte }), {})
})

test('el error del vencimiento dice la fecha de registro', () => {
    assert.match(conRegistro({ fecha_registro: '2014-08-20', fecha_vencimiento: '2014-08-20' }).fecha_vencimiento, /posterior al 20\/08\/2014/)
})
