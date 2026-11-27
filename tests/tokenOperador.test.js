import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.JWT_SECRET ??= 'secreto-de-la-app-para-los-tests-0123456789abcdef'
process.env.ADMIN_JWT_SECRET = 'secreto-del-panel-para-los-tests-0123456789abcdef'
const { firmarTokenOperador, verificarTokenOperador, AUD_DESAFIO, AUD_SESION, configuracionTokenOperadorOk } = await import('../utils/tokenOperador.js')
const { firmarToken, verificarToken } = await import('../utils/token.js')

test('la sesión del operador se verifica como sesión, no como desafío', () => {
    const sesion = firmarTokenOperador(3, 1)
    assert.deepEqual(verificarTokenOperador(sesion, AUD_SESION), { operadorId: 3, tv: 1, desafioId: undefined })
    assert.equal(verificarTokenOperador(sesion, AUD_DESAFIO), null)
})

test('el desafío (paso 1) no sirve como sesión', () => {
    const desafio = firmarTokenOperador(3, 1, AUD_DESAFIO, 'abc123')
    // Lleva su identificador de un solo uso (Case, A1 de la etapa 2)
    assert.deepEqual(verificarTokenOperador(desafio, AUD_DESAFIO), { operadorId: 3, tv: 1, desafioId: 'abc123' })
    assert.equal(verificarTokenOperador(desafio, AUD_SESION), null)
})

test('un token de cliente no sirve en el panel, ni uno del panel en la app', () => {
    assert.equal(verificarTokenOperador(firmarToken(3, 1), AUD_SESION), null)
    assert.equal(verificarToken(firmarTokenOperador(3, 1)), null)
})

test('la sesión del panel dura 1 hora', () => {
    const payload = JSON.parse(Buffer.from(firmarTokenOperador(3, 0).split('.')[1], 'base64url').toString())
    assert.equal(payload.exp - payload.iat, 3600)
})

test('la clave del panel no puede ser la misma que la de la app', () => {
    const original = process.env.ADMIN_JWT_SECRET
    process.env.ADMIN_JWT_SECRET = process.env.JWT_SECRET
    assert.equal(configuracionTokenOperadorOk(), false)
    assert.throws(() => firmarTokenOperador(3, 0), /distinto de JWT_SECRET/)
    process.env.ADMIN_JWT_SECRET = original
})
