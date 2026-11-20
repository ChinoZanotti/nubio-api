import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    faltaLugarEnCola, encolarAlertasParaMarcas, MAX_MARCAS_EN_COLA, MAX_MARCAS_EN_COLA_POR_USUARIO,
} from '../services/alertas.js'
import { handleCreateMarcasBulk, MAX_MARCAS_POR_USUARIO } from '../controllers/marcas.js'

// Una "base" que explota: el trabajo falla, pero el lugar se tiene que liberar igual.
const dbQueFalla = () => { throw new Error('base caída') }
const ids = (n, desde = 1) => Array.from({ length: n }, (_, i) => desde + i)

test('la fila tiene tope global y libera el lugar al terminar (aunque el trabajo falle)', async (t) => {
    t.mock.method(console, 'error', () => {}) // el trabajo falla a propósito: no ensuciar la salida
    assert.equal(faltaLugarEnCola(1, MAX_MARCAS_EN_COLA_POR_USUARIO), null)

    // 5 usuarios distintos llenan las 5000 plazas, 1000 cada uno
    const trabajos = [1, 2, 3, 4, 5].map((u) => encolarAlertasParaMarcas(dbQueFalla, ids(1000), u))
    assert.equal(faltaLugarEnCola(6, 1), 'servidor')

    await Promise.all(trabajos)
    assert.equal(faltaLugarEnCola(6, MAX_MARCAS_EN_COLA_POR_USUARIO), null)
})

test('M4: una sola cuenta no puede ocupar toda la fila', async (t) => {
    t.mock.method(console, 'error', () => {})
    const trabajo = encolarAlertasParaMarcas(dbQueFalla, ids(MAX_MARCAS_EN_COLA_POR_USUARIO), 7)
    // la misma cuenta no puede encolar ni una marca más hasta que termine...
    assert.equal(faltaLugarEnCola(7, 1), 'usuario')
    // ...pero las demás sí, porque la fila sigue con lugar
    assert.equal(faltaLugarEnCola(8, 1000), null)
    assert.ok(MAX_MARCAS_EN_COLA > MAX_MARCAS_EN_COLA_POR_USUARIO)

    await trabajo
    assert.equal(faltaLugarEnCola(7, MAX_MARCAS_EN_COLA_POR_USUARIO), null)
})

// Base falsa mínima: solo lo que usa verificarCapacidad (el COUNT de marcas del usuario).
function dbConMarcas(total) {
    return () => ({
        where() { return this },
        count() { return this },
        first: async () => ({ total: String(total) }), // Postgres devuelve el COUNT como texto
        insert() { throw new Error('no debería insertar') },
    })
}

async function importar(db, cantidad) {
    const marcas = Array.from({ length: cantidad }, (_, i) => ({
        fecha_solicitud: '2026-01-15', expediente: String(1000 + i), clase_niza: 30,
        denominacion: 'MARCA ' + i, signo: 'D', titular: 'X', pais: 'PY',
    }))
    const res = { status(c) { this.codigo = c; return this }, json(b) { this.cuerpo = b; return this }, set() { return this } }
    await handleCreateMarcasBulk({ userId: 1, body: { marcas } }, res, db)
    return res
}

test('una importación que pasaría el tope de marcas por usuario se rechaza sin insertar', async () => {
    const res = await importar(dbConMarcas(MAX_MARCAS_POR_USUARIO - 10), 20)
    assert.equal(res.codigo, 400)
    assert.match(res.cuerpo.error, /hasta 5000 marcas por cuenta/)
})
