import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compararMarcas, relacionClase, UMBRAL_ALERTA } from '../utils/similitud/index.js'

const marca = (denominacion, clase_niza = 25) => ({ denominacion, clase_niza })
const score = (a, b, ca = 25, cb = 25) => compararMarcas(marca(a, ca), marca(b, cb)).score

test('idénticas salvo forma societaria: puntaje máximo', () => {
    const r = compararMarcas(marca('NUBIO S.A.'), marca('Nubio'))
    assert.equal(r.score, 100)
    assert.equal(r.nivel, 'alta')
})

test('variantes fonéticas dan alerta alta', () => {
    for (const [a, b] of [['BIOTERM', 'BIOTHERM'], ['RIVAN', 'RIBAN'], ['WILSON', 'UILSON'], ['JASY', 'YASY']]) {
        const r = compararMarcas(marca(a), marca(b))
        assert.equal(r.nivel, 'alta', `${a} / ${b}: ${r.score}`)
        assert.ok(r.motivos.includes('Fonética'), `${a} / ${b}`)
    }
})

test('mi marca contenida en otra más larga', () => {
    const r = compararMarcas(marca('NUBIO'), marca('NUBIO EXPRESS'))
    assert.ok(r.motivos.includes('Contención'))
    assert.ok(r.score >= 85, `score ${r.score}`)
})

test('coincidir solo en términos genéricos no genera alerta', () => {
    assert.ok(score('PARAGUAY FOODS', 'PARAGUAY TECH') < UMBRAL_ALERTA)
    assert.ok(score('LA CASA', 'LA MESA DEL SUR') < UMBRAL_ALERTA)
})

test('compartir solo la primera palabra no da alerta alta', () => {
    assert.notEqual(compararMarcas(marca('CAFE NUBIO'), marca('CAFE TORRES')).nivel, 'alta')
})

test('marcas distintas no generan alerta', () => {
    assert.ok(score('NUBIO', 'TELEFE') < UMBRAL_ALERTA)
    assert.ok(score('ALBIRROJA', 'COCA COLA') < UMBRAL_ALERTA)
})

test('la clase pondera: misma suma, relacionada neutra, otra resta', () => {
    const misma = score('RIVAN', 'RIVEN', 5, 5)
    const relacionada = score('RIVAN', 'RIVEN', 5, 3)
    const otra = score('RIVAN', 'RIVEN', 5, 41)
    assert.equal(misma - relacionada, 5)
    assert.equal(relacionada - otra, 15)
})

test('con parecido muy alto no se resta por clase (posible notoria)', () => {
    const otraClase = score('BIOTERM', 'BIOTHERM', 3, 41)
    assert.ok(otraClase >= 95)
    assert.equal(otraClase, score('BIOTERM', 'BIOTHERM', 3, 5)) // igual que con clase relacionada (ajuste 0)
})

test('relacionClase es simétrica', () => {
    assert.equal(relacionClase(3, 5), 'relacionada')
    assert.equal(relacionClase(5, 3), 'relacionada')
    assert.equal(relacionClase(25, 25), 'misma')
    assert.equal(relacionClase(25, 5), 'otra')
})

test('marca sin denominación no compara', () => {
    assert.equal(compararMarcas(marca(null), marca('NUBIO')).score, 0)
})
