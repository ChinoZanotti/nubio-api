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

test('filtros: JSON válido, campos de la lista blanca y valores de texto', () => {
    const ok = parsearConsulta({ filtros: JSON.stringify([{ campo: 'denominacion', valor: 'café' }]) })
    assert.deepEqual(ok.consulta.filtros, [{ campo: 'denominacion', valor: 'café' }])
    for (const filtros of [
        'no es json',
        JSON.stringify({ campo: 'denominacion' }),                // no es array
        JSON.stringify([{ campo: 'hash', valor: 'x' }]),         // campo fuera de la lista
        JSON.stringify([{ campo: '__proto__', valor: 'x' }]),
        JSON.stringify([{ campo: 'titular', valor: 5 }]),        // valor que no es texto
        JSON.stringify([{ campo: 'titular', valor: 'x'.repeat(201) }]),
        JSON.stringify(Array(21).fill({ campo: 'titular', valor: 'x' })),
    ]) {
        assert.ok(parsearConsulta({ filtros }).error, filtros)
    }
})

test('filtros de fecha: aaaa-mm-dd o vacío', () => {
    const f = (desde, hasta) => parsearConsulta({ filtros: JSON.stringify([{ campo: 'fecha_publicacion', desde, hasta }]) })
    assert.ok(f('2026-10-01', '2026-10-15').consulta)
    assert.ok(f('', '2026-10-15').consulta)
    assert.ok(f('01/10/2026', '').error)
    assert.ok(f("2026-10-01' or 1=1", '').error)
})
