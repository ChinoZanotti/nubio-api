import { test } from 'node:test'
import assert from 'node:assert/strict'
import { crearLimiteSimultaneo } from '../middleware/simultaneos.js'

// res falso: guarda el status que se mandó
const resFalso = () => ({ estado: 200, status(s) { this.estado = s; return this }, json() { return this } })

// Un trabajo que no termina hasta que lo soltamos, como una consulta lenta
function trabajoPendiente() {
    let soltar
    const promesa = new Promise((r) => { soltar = r })
    return { trabajo: () => promesa, soltar }
}

test('frena el trabajo que pasa el máximo en curso, y libera al terminar', async () => {
    const conTurno = crearLimiteSimultaneo({ maximo: 2, mensaje: 'esperá' })
    const a = trabajoPendiente()
    const b = trabajoPendiente()
    const pa = conTurno({ userId: 1 }, resFalso(), a.trabajo)
    const pb = conTurno({ userId: 1 }, resFalso(), b.trabajo)

    // El tercero del mismo usuario, con dos en curso: 429 y no corre
    let corrio = false
    const res3 = resFalso()
    await conTurno({ userId: 1 }, res3, async () => { corrio = true })
    assert.equal(res3.estado, 429)
    assert.equal(corrio, false)

    // Otro usuario no se ve afectado
    const otro = resFalso()
    await conTurno({ userId: 2 }, otro, async () => {})
    assert.equal(otro.estado, 200)

    // Termina uno: vuelve a haber lugar
    a.soltar()
    await pa
    const res4 = resFalso()
    await conTurno({ userId: 1 }, res4, async () => {})
    assert.equal(res4.estado, 200)
    b.soltar()
    await pb
})

test('si el trabajo falla, igual libera el lugar', async () => {
    const conTurno = crearLimiteSimultaneo({ maximo: 1, mensaje: 'esperá' })
    await assert.rejects(conTurno({ userId: 1 }, resFalso(), async () => { throw new Error('falló la base') }))
    const res = resFalso()
    await conTurno({ userId: 1 }, res, async () => {})
    assert.equal(res.estado, 200)
})
