import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describirError, registrarError } from '../utils/log.js'

// Un error como los que arma `pg` ante un unique violation.
function errorDePostgres() {
    const err = new Error('duplicate key value violates unique constraint "login_email_key"')
    err.code = '23505'
    err.constraint = 'login_email_key'
    err.detail = 'Key (email)=(ana@estudio.com) already exists.'
    err.table = 'login'
    return err
}

test('describirError incluye código, restricción y mensaje', () => {
    const texto = describirError(errorDePostgres())
    assert.match(texto, /code=23505/)
    assert.match(texto, /constraint=login_email_key/)
    assert.match(texto, /duplicate key/)
})

test('el log NUNCA incluye detail (ahí Postgres pone los datos)', (t) => {
    const escrito = []
    t.mock.method(console, 'error', (...args) => escrito.push(args.join(' ')))
    registrarError('POST /register', errorDePostgres())
    assert.equal(escrito.length, 1)
    assert.doesNotMatch(escrito[0], /ana@estudio\.com/)
    assert.match(escrito[0], /^POST \/register:/)
})

test('describirError aguanta errores raros', () => {
    assert.equal(describirError(null), 'error desconocido')
    assert.equal(describirError('texto suelto'), 'texto suelto')
})
