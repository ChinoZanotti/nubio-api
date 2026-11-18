import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsearLineaCsv, celdaCsv } from '../utils/csv.js'

test('separa una línea simple', () => {
    assert.deepEqual(parsearLineaCsv('a,b,c'), ['a', 'b', 'c'])
})

test('respeta las comas dentro de comillas', () => {
    const linea = '2026-11-06,26106126,PY,"Stanley Zarza, Patricia Elizabeth",746'
    assert.deepEqual(parsearLineaCsv(linea), [
        '2026-11-06', '26106126', 'PY', 'Stanley Zarza, Patricia Elizabeth', '746',
    ])
})

test('convierte la comilla doble escapada en una sola', () => {
    assert.deepEqual(parsearLineaCsv('"dice ""hola""",x'), ['dice "hola"', 'x'])
})

test('conserva celdas vacías, también al final', () => {
    assert.deepEqual(parsearLineaCsv('a,,c,'), ['a', '', 'c', ''])
})

test('celdaCsv agrega comillas solo cuando hacen falta', () => {
    assert.equal(celdaCsv('Pastor Roche Galeano'), 'Pastor Roche Galeano')
    assert.equal(celdaCsv('Ramirez Gonzalez, Sergio'), '"Ramirez Gonzalez, Sergio"')
    assert.equal(celdaCsv('dice "hola"'), '"dice ""hola"""')
    assert.equal(celdaCsv(null), '')
})

test('celdaCsv y parsearLineaCsv son inversas', () => {
    const valores = ['a', 'b, c', 'd "e"', '']
    assert.deepEqual(parsearLineaCsv(valores.map(celdaCsv).join(',')), valores)
})
