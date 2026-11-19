import { test } from 'node:test'
import assert from 'node:assert/strict'
import { crearDb } from '../db.js'

// Lo que knex le va a pasar a pg: la URL final y el ssl. No se conecta.
function configCon(url) {
    process.env.DATABASE_URL = url
    const db = crearDb()
    const { connectionString, ssl } = db.client.config.connection
    db.destroy()
    return { connectionString, ssl }
}

const NEON = 'postgresql://u:p@ep-x-123.us-east-2.aws.neon.tech/db'

test('Neon: se saca sslmode=require de la URL y manda rejectUnauthorized: true', () => {
    const { connectionString, ssl } = configCon(`${NEON}?sslmode=require&channel_binding=require`)
    assert.doesNotMatch(connectionString, /sslmode/)
    assert.match(connectionString, /channel_binding=require/) // el resto de los parámetros queda
    assert.deepEqual(ssl, { rejectUnauthorized: true })
})

test('Neon sin sslmode: verifica igual', () => {
    assert.deepEqual(configCon(NEON).ssl, { rejectUnauthorized: true })
})

test('Neon con sslmode=no-verify o disable: no arranca', () => {
    for (const modo of ['no-verify', 'disable']) {
        assert.throws(() => configCon(`${NEON}?sslmode=${modo}`), /no se verificaría/)
    }
})

test('base local: sin TLS y la URL queda igual', () => {
    const url = 'postgresql://u:p@localhost:5432/nubio'
    assert.deepEqual(configCon(url), { connectionString: url, ssl: false })
})

test('un host que solo CONTIENE "neon.tech" no se trata como Neon', () => {
    // antes se usaba url.includes('neon.tech'); ahora se mira el hostname real
    assert.equal(configCon('postgresql://u:neon.tech@localhost/db').ssl, false)
})
