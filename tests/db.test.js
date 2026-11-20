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

test('B4: ssl=0 (o false) en una URL de Neon no arranca', () => {
    for (const valor of ['0', 'false', 'FALSE']) {
        assert.throws(() => configCon(`${NEON}?ssl=${valor}`), /no se verificaría/, valor)
    }
})

test('B4: se sacan todos los parámetros ssl* y uselibpqcompat, y se conserva el resto', () => {
    const { connectionString, ssl } = configCon(
        `${NEON}?ssl=true&sslrootcert=/tmp/x.pem&sslcert=/tmp/c&sslkey=/tmp/k&uselibpqcompat=true&sslmode=require&channel_binding=require&application_name=nubio`,
    )
    assert.doesNotMatch(connectionString, /ssl|uselibpqcompat/i)
    assert.match(connectionString, /channel_binding=require/)
    assert.match(connectionString, /application_name=nubio/)
    assert.deepEqual(ssl, { rejectUnauthorized: true })
})
