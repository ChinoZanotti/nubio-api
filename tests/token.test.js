import { test } from 'node:test'
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'

// Secreto solo para los tests: no depende del .env.
process.env.JWT_SECRET = 'secreto-de-prueba-con-mas-de-32-caracteres!!'

const { firmarToken, verificarToken } = await import('../utils/token.js')
const { requireAuth } = await import('../middleware/requireAuth.js')

test('un token firmado devuelve el id del usuario', () => {
    assert.equal(verificarToken(firmarToken(42)), 42)
})

test('un token modificado se rechaza', () => {
    // Cambiamos el payload (sub: 42 -> 1) sin volver a firmar: la firma ya no coincide.
    const [header, , firma] = firmarToken(42).split('.')
    const payloadFalso = Buffer.from(JSON.stringify({ sub: '1' })).toString('base64url')
    assert.equal(verificarToken(`${header}.${payloadFalso}.${firma}`), null)
})

test('un token firmado con otro secreto se rechaza', () => {
    const ajeno = jwt.sign({}, 'otro-secreto-cualquiera-de-mas-de-32-caracteres', { subject: '42' })
    assert.equal(verificarToken(ajeno), null)
})

test('un token sin firma (alg none) se rechaza', () => {
    const sinFirma = jwt.sign({}, null, { algorithm: 'none', subject: '42' })
    assert.equal(verificarToken(sinFirma), null)
})

test('un token vencido se rechaza', () => {
    const vencido = jwt.sign({}, process.env.JWT_SECRET, { subject: '42', expiresIn: -10 })
    assert.equal(verificarToken(vencido), null)
})

// Simula req/res de Express para probar el middleware sin levantar el servidor.
function correrMiddleware(authorization) {
    const req = { headers: authorization ? { authorization } : {} }
    const res = {
        status(codigo) { this.codigo = codigo; return this },
        json(cuerpo) { this.cuerpo = cuerpo; return this },
    }
    let siguio = false
    requireAuth(req, res, () => { siguio = true })
    return { req, res, siguio }
}

test('requireAuth deja pasar con token válido y pone req.userId', () => {
    const { req, siguio } = correrMiddleware(`Bearer ${firmarToken(7)}`)
    assert.equal(siguio, true)
    assert.equal(req.userId, 7)
})

test('requireAuth corta con 401 sin token o con token inválido', () => {
    for (const header of [undefined, 'Bearer', 'Bearer basura', `Basic ${firmarToken(7)}`]) {
        const { res, siguio } = correrMiddleware(header)
        assert.equal(siguio, false)
        assert.equal(res.codigo, 401)
    }
})
