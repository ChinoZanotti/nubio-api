import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aBase32, codigoDelPaso, verificarCodigo, generarSecreto, uriOtpauth } from '../utils/totp.js'

// Vectores de prueba del RFC 6238 (apéndice B), variante SHA-1, 8 dígitos.
// Secreto: los bytes ASCII de "12345678901234567890".
const SECRETO_RFC = aBase32(Buffer.from('12345678901234567890'))

test('el secreto del RFC en base32 es el conocido', () => {
    assert.equal(SECRETO_RFC, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')
})

test('códigos del RFC 6238 (SHA-1)', () => {
    const casos = [
        [59, '94287082'],
        [1111111109, '07081804'],
        [1111111111, '14050471'],
        [1234567890, '89005924'],
        [2000000000, '69279037'],
        [20000000000, '65353130'],
    ]
    for (const [segundos, esperado] of casos) {
        assert.equal(codigoDelPaso(SECRETO_RFC, Math.floor(segundos / 30), 8), esperado, `T=${segundos}`)
    }
})

test('verificarCodigo acepta el período actual y los vecinos, no más lejos', () => {
    const ahora = 1234567890 * 1000
    const paso = Math.floor(1234567890 / 30)
    assert.equal(verificarCodigo(SECRETO_RFC, codigoDelPaso(SECRETO_RFC, paso), { ahora }), paso)
    assert.equal(verificarCodigo(SECRETO_RFC, codigoDelPaso(SECRETO_RFC, paso - 1), { ahora }), paso - 1)
    assert.equal(verificarCodigo(SECRETO_RFC, codigoDelPaso(SECRETO_RFC, paso + 1), { ahora }), paso + 1)
    assert.equal(verificarCodigo(SECRETO_RFC, codigoDelPaso(SECRETO_RFC, paso - 3), { ahora }), null)
})

test('un código ya usado no se acepta dos veces', () => {
    const ahora = 1234567890 * 1000
    const paso = Math.floor(1234567890 / 30)
    const codigo = codigoDelPaso(SECRETO_RFC, paso)
    assert.equal(verificarCodigo(SECRETO_RFC, codigo, { ahora, ultimoPaso: paso }), null)
    assert.equal(verificarCodigo(SECRETO_RFC, codigo, { ahora, ultimoPaso: paso - 1 }), paso)
})

test('verificarCodigo rechaza lo que no son 6 dígitos y tolera espacios', () => {
    const ahora = 1234567890 * 1000
    const codigo = codigoDelPaso(SECRETO_RFC, Math.floor(1234567890 / 30))
    assert.equal(verificarCodigo(SECRETO_RFC, `${codigo.slice(0, 3)} ${codigo.slice(3)}`, { ahora }) !== null, true)
    for (const malo of ['', '12345', '1234567', 'abcdef', null, undefined, 123456]) {
        assert.equal(verificarCodigo(SECRETO_RFC, malo, { ahora }), null)
    }
})

test('el secreto generado tiene 32 caracteres base32 (160 bits) y es distinto cada vez', () => {
    const a = generarSecreto()
    assert.match(a, /^[A-Z2-7]{32}$/)
    assert.notEqual(a, generarSecreto())
})

test('el URI del QR lleva emisor, correo y secreto', () => {
    const uri = uriOtpauth('ABCDEF', 'ana@estudio.com')
    assert.match(uri, /^otpauth:\/\/totp\/Nubio%20Panel%3Aana%40estudio\.com\?secret=ABCDEF&issuer=Nubio%20Panel/)
})
