import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
    esperaPendiente, registrarIntento, registrarExito, esIpConocida, barrerVencidos, reiniciarIntentos, tamanos,
    FALLOS_LIBRES, ESPERA_MAXIMA_S,
} from '../utils/intentosPorCuenta.js'

const EMAIL = 'ana@estudio.com'
const IP_ATACANTE = '203.0.113.9'
const IP_OFICINA = '198.51.100.20'
const T0 = 1_000_000_000_000 // un instante fijo: los tests no dependen del reloj
const fallar = (veces, en = T0) => { for (let i = 0; i < veces; i++) registrarIntento(EMAIL, en) }

beforeEach(() => reiniciarIntentos())

test('los primeros 10 fallos no tienen espera', () => {
    fallar(FALLOS_LIBRES - 1)
    assert.equal(esperaPendiente(EMAIL, IP_ATACANTE, T0), 0)
})

test('desde el fallo 10, la espera se duplica: 1, 2, 4... segundos', () => {
    fallar(FALLOS_LIBRES)
    assert.equal(esperaPendiente(EMAIL, IP_ATACANTE, T0), 1)
    registrarIntento(EMAIL, T0)
    assert.equal(esperaPendiente(EMAIL, IP_ATACANTE, T0), 2)
    registrarIntento(EMAIL, T0)
    assert.equal(esperaPendiente(EMAIL, IP_ATACANTE, T0), 4)
})

test('la espera nunca pasa de 60 segundos', () => {
    fallar(FALLOS_LIBRES + 30)
    assert.equal(esperaPendiente(EMAIL, IP_ATACANTE, T0), ESPERA_MAXIMA_S)
    assert.equal(esperaPendiente(EMAIL, IP_ATACANTE, T0 + ESPERA_MAXIMA_S * 1000), 0)
})

test('un login correcto borra el contador', () => {
    fallar(FALLOS_LIBRES + 5)
    registrarExito(EMAIL, IP_OFICINA, T0)
    assert.equal(esperaPendiente(EMAIL, IP_ATACANTE, T0), 0)
})

test('los fallos de hace más de una hora se olvidan', () => {
    fallar(FALLOS_LIBRES + 5)
    assert.equal(esperaPendiente(EMAIL, IP_ATACANTE, T0 + 61 * 60 * 1000), 0)
})

test('cada email tiene su propio contador', () => {
    fallar(FALLOS_LIBRES + 5)
    assert.equal(esperaPendiente('otra@estudio.com', IP_ATACANTE, T0), 0)
})

// --- M2: la víctima no queda trabada desde donde siempre entra ---
test('desde una IP donde el email ya entró, no hay demora aunque lo estén atacando', () => {
    registrarExito(EMAIL, IP_OFICINA, T0)         // ayer entró desde la oficina
    fallar(FALLOS_LIBRES + 30, T0 + 1000)         // hoy la atacan desde otras IPs
    assert.equal(esperaPendiente(EMAIL, IP_ATACANTE, T0 + 1000), ESPERA_MAXIMA_S)
    assert.equal(esperaPendiente(EMAIL, IP_OFICINA, T0 + 1000), 0)
})

test('la IP conocida es por email: no le sirve al atacante para otra cuenta', () => {
    registrarExito(EMAIL, IP_OFICINA, T0)
    assert.equal(esIpConocida(EMAIL, IP_OFICINA, T0), true)
    assert.equal(esIpConocida('otra@estudio.com', IP_OFICINA, T0), false)
})

test('una IP conocida vence a los 30 días', () => {
    registrarExito(EMAIL, IP_OFICINA, T0)
    assert.equal(esIpConocida(EMAIL, IP_OFICINA, T0 + 29 * 86_400_000), true)
    assert.equal(esIpConocida(EMAIL, IP_OFICINA, T0 + 31 * 86_400_000), false)
})

// --- A1: memoria ---
test('se guarda un hash de largo fijo, no el email: un "email" enorme no ocupa más', () => {
    registrarIntento('a'.repeat(1_000_000) + '@x.com', T0)
    assert.equal(tamanos().fallos, 1)
    // (el tamaño de cada clave es el de un SHA-256, igual para cualquier email)
})

test('el barrido borra lo vencido', () => {
    for (let i = 0; i < 100; i++) registrarIntento(`inventado${i}@x.com`, T0)
    registrarExito(EMAIL, IP_OFICINA, T0)
    assert.deepEqual(tamanos(), { fallos: 100, ipsConocidas: 1 })
    barrerVencidos(T0 + 61 * 60 * 1000)           // pasó más de una hora
    assert.deepEqual(tamanos(), { fallos: 0, ipsConocidas: 1 })
    barrerVencidos(T0 + 31 * 86_400_000)          // pasaron más de 30 días
    assert.deepEqual(tamanos(), { fallos: 0, ipsConocidas: 0 })
})
