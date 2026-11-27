import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compararMarcas, relacionClase, prepararMarca, mismoTitular, UMBRAL_ALERTA } from '../utils/similitud/index.js'
import { normalizarTitular, quitarGenericos } from '../utils/similitud/normalizar.js'

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
    assert.ok(score('ARSIS', 'L LIXHI BARRIOS STORE') < UMBRAL_ALERTA) // caso real del boletín 2026-10-19
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

// ===== Palabras descriptivas por clase (confirmado por la abogada, noviembre 2026) =====
test('descriptiva como único punto en común: no hay alerta (CAFE NUBIO / CAFE TORRES, clase 30)', () => {
    const r = compararMarcas(marca('CAFE NUBIO', 30), marca('CAFE TORRES', 30))
    assert.equal(r.nivel, null, `score ${r.score}`)
})

test('descriptiva junto a algo distintivo: la alerta sigue (NUBIO / NUBIO CAFE, clase 30)', () => {
    const r = compararMarcas(marca('NUBIO', 30), marca('NUBIO CAFE', 30))
    assert.equal(r.score, 100)
    assert.equal(r.nivel, 'alta')
})

test('la palabra es descriptiva solo en SU clase: CAFE en la 9 sigue contando', () => {
    // Sin la lista, CAFE NUBIO / CAFE TORRES da 71 en la misma clase; en la 9 CAFE no es descriptiva
    const r = compararMarcas(marca('CAFE NUBIO', 9), marca('CAFE TORRES', 9))
    assert.ok(r.score >= UMBRAL_ALERTA, `score ${r.score}`)
})

test('una marca hecha solo de palabras descriptivas se compara entera', () => {
    assert.deepEqual(quitarGenericos(['EL', 'CAFE'], 30), ['CAFE'])
    assert.deepEqual(quitarGenericos(['CAFE', 'NUBIO'], 30), ['NUBIO'])
    assert.deepEqual(quitarGenericos(['CAFE', 'NUBIO'], 9), ['CAFE', 'NUBIO'])
    assert.deepEqual(quitarGenericos(['EL', 'DE']), ['EL', 'DE'])
})

test('genéricas nuevas: ESLOGAN y conectores no cuentan', () => {
    assert.equal(compararMarcas(marca('NUBIO (ESLOGAN)'), marca('NUBIO')).score, 100)
    assert.equal(compararMarcas(marca('QUE NUBIO'), marca('NUBIO')).score, 100)
    // MAS no es genérica: puede ser lo distintivo de una marca ("MÁS", revisión de Case, M5)
    assert.ok(compararMarcas(marca('MAS'), marca('SUPER MAS')).score >= UMBRAL_ALERTA)
})

// ===== Mismo titular (confirmado por la abogada: "no aplica") =====
test('normalizarTitular: casi literal, unificando solo la forma societaria', () => {
    assert.equal(normalizarTitular('Nubio S.A.'), normalizarTitular('NUBIO SA'))
    assert.equal(normalizarTitular('Nubio S. A.'), normalizarTitular('nubio sa'))
    assert.equal(normalizarTitular('Nubio Sociedad Anónima'), normalizarTitular('NUBIO S.A.'))
    assert.equal(normalizarTitular('Nichebox UK Limited'), normalizarTitular('NICHEBOX UK LTD'))
    assert.equal(normalizarTitular('José  Pérez'), normalizarTitular('JOSE PEREZ'))
    assert.equal(normalizarTitular('S.A.'), '')
    assert.equal(normalizarTitular(''), '')
})

test('normalizarTitular: NO hace iguales a titulares distintos (revisión de Case, A1)', () => {
    assert.notEqual(normalizarTitular('Gloria S.A.'), normalizarTitular('Gloria S.R.L.'))
    assert.notEqual(normalizarTitular('Gloria S.A.'), normalizarTitular('Gloria Inc.'))
    assert.notEqual(normalizarTitular('María de los Ángeles Benítez'), normalizarTitular('María Ángeles Benítez'))
    assert.notEqual(normalizarTitular('González González, María'), normalizarTitular('María González'))
    assert.notEqual(normalizarTitular('Juan Carlos Pérez'), normalizarTitular('Carlos Juan Pérez'))
    assert.notEqual(normalizarTitular('Banco X Paraguay S.A.'), normalizarTitular('Banco X S.A.'))
})

test('mismoTitular: titular normalizado igual Y mismo país', () => {
    const p = (titular, pais = 'PY') => prepararMarca({ denominacion: 'X', clase_niza: 25, titular, pais })
    assert.equal(mismoTitular(p('Nubio S.A.'), p('NUBIO SA')), true)
    assert.equal(mismoTitular(p('Juan Ramón Bueno Jara'), p('JUAN RAMON BUENO JARA')), true)
    assert.equal(mismoTitular(p('Nubio S.A.', 'PY'), p('Nubio S.A.', 'AR')), false) // otro país
    assert.equal(mismoTitular(p('Nubio S.A.', ''), p('Nubio S.A.', '')), false) // sin país no se decide
    assert.equal(mismoTitular(p('Juan Ramón Bueno Jara'), p('Juan Ramón Bueno')), false)
    assert.equal(mismoTitular(p(''), p('')), false)
    assert.equal(mismoTitular(p('S.A.'), p('S.A.')), false) // solo forma societaria
})
