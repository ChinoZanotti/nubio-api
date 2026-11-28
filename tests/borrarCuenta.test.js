import { test } from 'node:test'
import assert from 'node:assert/strict'
import { desconocidas, CLAVES_CONOCIDAS, COLUMNAS_CONOCIDAS } from '../services/borrarCuenta.js'

const claves = (lista) => lista.map((c) => {
    const [origen, apuntaA] = c.split('→')
    const [tabla, columna] = origen.split('.')
    return { tabla, columna, apunta_a: apuntaA }
})
const columnas = (lista) => lista.map((c) => { const [tabla, columna] = c.split('.'); return { tabla, columna } })
const HOY = { claves: claves(CLAVES_CONOCIDAS), columnas: columnas(COLUMNAS_CONOCIDAS) }

test('con las tablas de hoy, no hay nada desconocido', () => {
    assert.deepEqual(desconocidas(HOY), [])
})

test('una tabla nueva que apunta a usuarios frena el borrado', () => {
    assert.deepEqual(desconocidas({ ...HOY, claves: [...HOY.claves, { tabla: 'sesiones', columna: 'user_id', apunta_a: 'users' }] }), ['sesiones.user_id→users'])
})

test('una tabla nueva que apunta a alertas también (el historial de alertas planeado)', () => {
    assert.deepEqual(desconocidas({ ...HOY, claves: [...HOY.claves, { tabla: 'alertas_historial', columna: 'alerta_id', apunta_a: 'alertas' }] }), ['alertas_historial.alerta_id→alertas'])
})

test('una columna user_id sin clave foránea también frena (no la ve la consulta de claves)', () => {
    assert.deepEqual(desconocidas({ ...HOY, columnas: [...HOY.columnas, { tabla: 'eventos', columna: 'user_id' }] }), ['eventos.user_id'])
})

test('una tabla de otro esquema se distingue de la de public', () => {
    assert.deepEqual(desconocidas({ claves: [{ tabla: 'archivo.marcas', columna: 'user_id', apunta_a: 'users' }] }), ['archivo.marcas.user_id→users'])
})
