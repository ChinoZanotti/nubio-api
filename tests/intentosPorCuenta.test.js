import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
    esperaPendiente, registrarFallo, registrarExito, reiniciarIntentos, FALLOS_LIBRES, ESPERA_MAXIMA_S,
} from '../utils/intentosPorCuenta.js'

const EMAIL = 'ana@estudio.com'
const T0 = 1_000_000_000_000 // un instante fijo: los tests no dependen del reloj
const fallar = (veces, desde = T0) => { for (let i = 0; i < veces; i++) registrarFallo(EMAIL, desde) }

beforeEach(() => reiniciarIntentos())

test('los primeros 10 fallos no tienen espera', () => {
    fallar(FALLOS_LIBRES - 1)
    assert.equal(esperaPendiente(EMAIL, T0), 0)
})

test('desde el fallo 10, la espera se duplica: 1, 2, 4... segundos', () => {
    fallar(FALLOS_LIBRES)
    assert.equal(esperaPendiente(EMAIL, T0), 1)
    registrarFallo(EMAIL, T0)
    assert.equal(esperaPendiente(EMAIL, T0), 2)
    registrarFallo(EMAIL, T0)
    assert.equal(esperaPendiente(EMAIL, T0), 4)
})

test('la espera nunca pasa de 60 segundos (la víctima siempre puede volver a entrar)', () => {
    fallar(FALLOS_LIBRES + 30)
    assert.equal(esperaPendiente(EMAIL, T0), ESPERA_MAXIMA_S)
    assert.equal(esperaPendiente(EMAIL, T0 + ESPERA_MAXIMA_S * 1000), 0)
})

test('pasado el tiempo de espera, se puede volver a intentar', () => {
    fallar(FALLOS_LIBRES + 2) // espera de 4 s
    assert.equal(esperaPendiente(EMAIL, T0 + 3000), 1)
    assert.equal(esperaPendiente(EMAIL, T0 + 4000), 0)
})

test('un login correcto borra el contador', () => {
    fallar(FALLOS_LIBRES + 5)
    registrarExito(EMAIL)
    assert.equal(esperaPendiente(EMAIL, T0), 0)
})

test('los fallos de hace más de una hora se olvidan', () => {
    fallar(FALLOS_LIBRES + 5)
    assert.equal(esperaPendiente(EMAIL, T0 + 61 * 60 * 1000), 0)
})

test('cada email tiene su propio contador', () => {
    fallar(FALLOS_LIBRES + 5)
    assert.equal(esperaPendiente('otra@estudio.com', T0), 0)
})
