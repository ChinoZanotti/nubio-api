import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsearConsulta } from '../controllers/boletines.js'

test('sin parámetros: página 1, 20 por página, más recientes primero', () => {
    assert.deepEqual(parsearConsulta({}).consulta, {
        pagina: 1, porPagina: 20, orden: 'fecha_publicacion', direccion: 'desc', filtros: [],
    })
})

test('página y tamaño fuera de rango se rechazan', () => {
    for (const q of [{ pagina: '0' }, { pagina: '-1' }, { pagina: '1.5' }, { pagina: 'abc' }, { porPagina: '101' }, { porPagina: '0' }]) {
        assert.ok(parsearConsulta(q).error, JSON.stringify(q))
    }
    assert.equal(parsearConsulta({ porPagina: '100' }).consulta.porPagina, 100)
})

test('solo se puede ordenar por las columnas de la lista blanca', () => {
    assert.equal(parsearConsulta({ orden: 'denominacion', direccion: 'asc' }).consulta.orden, 'denominacion')
    // un intento de inyección por el nombre de columna no llega al SQL
    for (const orden of ['created_at', 'id; drop table marcas', '__proto__', 'constructor']) {
        assert.ok(parsearConsulta({ orden }).error, orden)
    }
    assert.ok(parsearConsulta({ direccion: 'asc; drop' }).error)
})

test('filtros: array, campos de la lista blanca y valores de texto', () => {
    const ok = parsearConsulta({ filtros: ([{ campo: 'denominacion', valor: 'café' }]) })
    assert.deepEqual(ok.consulta.filtros, [{ campo: 'denominacion', valor: 'café' }])
    for (const filtros of [
        'no es json',
        ({ campo: 'denominacion' }),                // no es array
        ([{ campo: 'hash', valor: 'x' }]),         // campo fuera de la lista
        ([{ campo: '__proto__', valor: 'x' }]),
        ([{ campo: 'titular', valor: 5 }]),        // valor que no es texto
        ([{ campo: 'titular', valor: 'x'.repeat(201) }]),
        (Array(21).fill({ campo: 'titular', valor: 'x' })),
    ]) {
        assert.ok(parsearConsulta({ filtros }).error, filtros)
    }
})

test('filtros de fecha: aaaa-mm-dd o vacío', () => {
    const f = (desde, hasta) => parsearConsulta({ filtros: ([{ campo: 'fecha_publicacion', desde, hasta }]) })
    assert.ok(f('2026-10-01', '2026-10-15').consulta)
    assert.ok(f('', '2026-10-15').consulta)
    assert.ok(f('01/10/2026', '').error)
    assert.ok(f("2026-10-01' or 1=1", '').error)
})

test('B1: campo u orden como array (no texto) se rechazan con 400, no 500', () => {
    assert.ok(parsearConsulta({ filtros: ([{ campo: ['pais'], valor: 'PY' }]) }).error)
    assert.ok(parsearConsulta({ orden: ['denominacion'] }).error)
    assert.ok(parsearConsulta({ orden: ['a', 'b'] }).error) // ?orden=a&orden=b
    assert.ok(parsearConsulta({ filtros: ['[]'] }).error)    // ?filtros=..&filtros=..
})

test('B1: fechas con formato válido pero inexistentes se rechazan', () => {
    const f = (desde) => parsearConsulta({ filtros: ([{ campo: 'fecha_publicacion', desde }]) })
    for (const fecha of ['2026-99-99', '2026-02-30', '0000-01-01', '2026-13-01']) assert.ok(f(fecha).error, fecha)
    assert.ok(f('2024-02-29').consulta) // bisiesto: existe
})

test('los filtros que siguen adelante son solo lo validado (sin propiedades de más)', () => {
    const { consulta } = parsearConsulta({ filtros: ([{ campo: 'titular', valor: 'sa', extra: 'x', __proto__: { y: 1 } }]) })
    assert.deepEqual(consulta.filtros, [{ campo: 'titular', valor: 'sa' }])
})

test('POST: los filtros llegan como array en el cuerpo (y números sin pasar a texto)', () => {
    const { consulta } = parsearConsulta({
        pagina: 2, porPagina: 50, orden: 'titular', direccion: 'asc',
        filtros: [{ campo: 'denominacion', valor: 'cafe' }, { campo: 'fecha_publicacion', desde: '2026-10-01' }],
    })
    assert.deepEqual(consulta, {
        pagina: 2, porPagina: 50, orden: 'titular', direccion: 'asc',
        filtros: [{ campo: 'denominacion', valor: 'cafe' }, { campo: 'fecha_publicacion', desde: '2026-10-01', hasta: '' }],
    })
    // las mismas validaciones valen para el cuerpo
    assert.ok(parsearConsulta({ filtros: [{ campo: ['pais'], valor: 'PY' }] }).error)
    assert.ok(parsearConsulta({ filtros: { campo: 'pais' } }).error)
    assert.ok(parsearConsulta({ pagina: '1; drop' }).error)
})

test('los filtros como texto JSON (el formato del GET que se sacó) se rechazan', () => {
    assert.ok(parsearConsulta({ filtros: JSON.stringify([{ campo: 'titular', valor: 'sa' }]) }).error)
})
