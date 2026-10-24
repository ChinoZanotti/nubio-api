import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizar } from '../utils/similitud/normalizar.js'
import { claveEspanol, claveGuarani } from '../utils/similitud/fonetica.js'

const esp = (t) => claveEspanol(normalizar(t))
const gua = (t) => claveGuarani(normalizar(t))

test('normalizar quita acentos, puso y tildes nasales pero conserva la Ñ', () => {
    assert.equal(normalizar('Café Ñandutí'), 'CAFE ÑANDUTI')
    assert.equal(normalizar("Ka'a"), 'KAA')
    assert.equal(normalizar('Yvỹ'), 'YVY')
    assert.equal(normalizar('S.A.'), 'SA')
    assert.equal(normalizar('Pan & Vino'), 'PAN Y VINO')
})

test('español: suenan igual, misma clave', () => {
    const pares = [
        ['BIOTERM', 'BIOTHERM'],
        ['RIVAN', 'RIBAN'],
        ['CELESTE', 'SELESTE'],
        ['HUGO', 'UGO'],
        ['CASA', 'KASA'],
        ['WILSON', 'UILSON'],
        ['INVICTO', 'IMBICTO'],
        ['QUESO', 'KESO'],
        ['LLAVE', 'YABE'],
        ['GENTE', 'JENTE'],
        ['SPRITE', 'ESPRITE'],
    ]
    for (const [a, b] of pares) assert.equal(esp(a), esp(b), `${a} / ${b}`)
})

test('español: GUE no se convierte en JE', () => {
    assert.equal(esp('GUERRA'), 'GERA')
    assert.notEqual(esp('GUERRA'), esp('JERRA'))
})

test('la X suena KS y no se confunde con CH', () => {
    assert.equal(esp('TIMEX'), esp('TIMEKS'))
    assert.notEqual(esp('CHAMPION'), esp('KSAMPION'))
})

test('guaraní: la J suena como Y y la H aspirada como J', () => {
    assert.equal(gua('JASY'), gua('YASY'))
    assert.equal(gua('HU'), esp('JU'))
    assert.equal(gua('CHIPA'), esp('CHIPA')) // la CH no se toca
})

test('suenan distinto, clave distinta', () => {
    assert.notEqual(esp('NUBIO'), esp('TELEFE'))
    assert.notEqual(esp('RIVAN'), esp('RIVER'))
})
