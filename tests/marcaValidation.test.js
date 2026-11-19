import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    validarMarca, normalizarMarca, LARGO_MAXIMO_DENOMINACION, LARGO_MAXIMO_TITULAR,
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
