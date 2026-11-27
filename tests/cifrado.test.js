import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'

process.env.ADMIN_CIFRADO_KEY = randomBytes(32).toString('base64')
const { cifrar, descifrar, hmac } = await import('../utils/cifrado.js')

test('cifrar y descifrar devuelve el original, y cada cifrado es distinto', () => {
    const a = cifrar('JBSWY3DPEHPK3PXP', 'operador:5')
    const b = cifrar('JBSWY3DPEHPK3PXP', 'operador:5')
    assert.notEqual(a, b) // iv aleatorio
    assert.match(a, /^v1\./)
    assert.equal(descifrar(a, 'operador:5'), 'JBSWY3DPEHPK3PXP')
})

test('lo cifrado para un operador no se descifra como de otro (Case, B6)', () => {
    const guardado = cifrar('secreto', 'operador:5')
    assert.throws(() => descifrar(guardado, 'operador:6'))
})

test('sin contexto no cifra ni descifra', () => {
    assert.throws(() => cifrar('x'), /contexto/)
    assert.throws(() => descifrar(cifrar('x', 'operador:1')), /contexto/)
})

test('un cifrado alterado no se descifra', () => {
    const partes = cifrar('secreto', 'operador:5').split('.')
    const datos = Buffer.from(partes[3], 'base64url')
    datos[0] ^= 1
    partes[3] = datos.toString('base64url')
    assert.throws(() => descifrar(partes.join('.'), 'operador:5'))
})

test('con otra clave no se descifra', () => {
    const guardado = cifrar('secreto', 'operador:5')
    const original = process.env.ADMIN_CIFRADO_KEY
    process.env.ADMIN_CIFRADO_KEY = randomBytes(32).toString('base64')
    assert.throws(() => descifrar(guardado, 'operador:5'))
    process.env.ADMIN_CIFRADO_KEY = original
})

test('sin clave válida, cifrar falla en vez de guardar en claro', () => {
    const original = process.env.ADMIN_CIFRADO_KEY
    process.env.ADMIN_CIFRADO_KEY = 'corta'
    assert.throws(() => cifrar('x', 'operador:1'), /ADMIN_CIFRADO_KEY/)
    process.env.ADMIN_CIFRADO_KEY = original
})

test('el HMAC depende de la clave y del rótulo', () => {
    const a = hmac('activacion', 'token')
    assert.equal(a, hmac('activacion', 'token'))
    assert.notEqual(a, hmac('otro-uso', 'token'))
    const original = process.env.ADMIN_CIFRADO_KEY
    process.env.ADMIN_CIFRADO_KEY = randomBytes(32).toString('base64')
    assert.notEqual(a, hmac('activacion', 'token'))
    process.env.ADMIN_CIFRADO_KEY = original
})
