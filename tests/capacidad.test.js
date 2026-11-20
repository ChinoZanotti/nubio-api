import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    faltaLugarEnCola, encolarAlertasParaMarcas, reservarLugarEnCola, MAX_MARCAS_EN_COLA, MAX_MARCAS_EN_COLA_POR_USUARIO,
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
// Base falsa mínima: lo que usa insertarConTope (transacción, candado y COUNT).
// Anota qué se pidió para poder comprobarlo.
function dbConMarcas(total) {
    const pedidos = []
    const trx = () => ({
        where() { return this },
        count() { return this },
        first: async () => ({ total: String(total) }), // Postgres devuelve el COUNT como texto
        insert() { throw new Error('no debería insertar') },
    })
    trx.raw = async (sql, valores) => { pedidos.push({ sql, valores }) }
    const db = () => { throw new Error('todo tiene que pasar por la transacción') }
    db.transaction = async (fn) => fn(trx)
    db.pedidos = pedidos
    return db
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
    const db = dbConMarcas(MAX_MARCAS_POR_USUARIO - 10)
    const res = await importar(db, 20)
    assert.equal(res.codigo, 400)
    assert.match(res.cuerpo.error, /hasta 5000 marcas por cuenta/)
    // B3: el COUNT se hizo con el candado del usuario tomado
    assert.match(db.pedidos[0].sql, /pg_advisory_xact_lock/)
    assert.deepEqual(db.pedidos[0].valores, [1, 1])
    // y la reserva en la fila se devolvió: el usuario puede volver a intentar
    assert.equal(faltaLugarEnCola(1, MAX_MARCAS_EN_COLA_POR_USUARIO), null)
})

test('B3: reservar lugar en la fila es inmediato, sin carrera', async (t) => {
    t.mock.method(console, 'error', () => {})
    const primera = reservarLugarEnCola(9, 600)
    const segunda = reservarLugarEnCola(9, 600) // "en paralelo", antes de que la primera inserte
    assert.equal(primera.falta, null)
    assert.equal(segunda.falta, 'usuario') // antes pasaban las dos (1200 > 1000)
    // si entran menos (duplicadas), lo que sobró vuelve enseguida
    const trabajo = primera.encolar(dbQueFalla, ids(100))
    assert.equal(faltaLugarEnCola(9, 900), null)
    await trabajo
    assert.equal(faltaLugarEnCola(9, MAX_MARCAS_EN_COLA_POR_USUARIO), null)
    // liberar devuelve toda la reserva
    const tercera = reservarLugarEnCola(9, 1000)
    tercera.liberar()
    assert.equal(faltaLugarEnCola(9, MAX_MARCAS_EN_COLA_POR_USUARIO), null)
})
