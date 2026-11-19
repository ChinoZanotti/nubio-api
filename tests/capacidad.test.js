import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hayLugarEnCola, encolarAlertasParaMarcas, MAX_MARCAS_EN_COLA } from '../services/alertas.js'
import { handleCreateMarcasBulk, MAX_MARCAS_POR_USUARIO } from '../controllers/marcas.js'

test('la fila de alertas tiene tope y libera el lugar al terminar (aunque el trabajo falle)', async (t) => {
    t.mock.method(console, 'error', () => {}) // el trabajo falla a propósito: no ensuciar la salida
    assert.equal(hayLugarEnCola(MAX_MARCAS_EN_COLA), true)
    assert.equal(hayLugarEnCola(MAX_MARCAS_EN_COLA + 1), false)

    // Una "base" que explota: el trabajo falla, pero el lugar se tiene que liberar igual.
    const dbQueFalla = () => { throw new Error('base caída') }
    const ids = Array.from({ length: 3000 }, (_, i) => i + 1)
    const trabajo = encolarAlertasParaMarcas(dbQueFalla, ids)

    assert.equal(hayLugarEnCola(MAX_MARCAS_EN_COLA - 3000), true)
    assert.equal(hayLugarEnCola(MAX_MARCAS_EN_COLA - 3000 + 1), false)

    await trabajo
    assert.equal(hayLugarEnCola(MAX_MARCAS_EN_COLA), true)
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
