import { test } from 'node:test'
import assert from 'node:assert/strict'
import { domingoDePascua, esFeriado } from '../utils/feriados.js'
import { esDiaHabil, sumarDiasHabiles, diasHabilesEntre, venceOposicion } from '../utils/plazos.js'

test('Pascua y Semana Santa', () => {
    assert.equal(domingoDePascua(2026).toISOString().slice(0, 10), '2026-04-05')
    assert.ok(esFeriado('2026-04-02')) // Jueves Santo
    assert.ok(esFeriado('2026-04-03')) // Viernes Santo
})

test('fines de semana y feriados no son hábiles', () => {
    assert.equal(esDiaHabil('2026-10-24'), false) // sábado
    assert.equal(esDiaHabil('2026-10-25'), false) // domingo
    assert.equal(esDiaHabil('2026-12-25'), false) // Navidad
    assert.equal(esDiaHabil('2026-10-26'), true) // lunes
})

test('sumar días hábiles saltea fin de semana', () => {
    assert.equal(sumarDiasHabiles('2026-10-23', 1), '2026-10-26') // viernes + 1 = lunes
})

test('sumar días hábiles saltea Año Nuevo', () => {
    assert.equal(sumarDiasHabiles('2026-12-31', 1), '2027-01-04') // 1/1 viernes feriado, después finde
})

test('vencimiento de oposición: 60 días hábiles', () => {
    const vence = venceOposicion('2026-10-19')
    assert.equal(diasHabilesEntre('2026-10-19', vence), 60)
    assert.ok(esDiaHabil(vence))
})

test('días restantes negativos si ya venció', () => {
    assert.equal(diasHabilesEntre('2026-10-26', '2026-10-23'), -1)
    assert.equal(diasHabilesEntre('2026-10-26', '2026-10-26'), 0)
})
