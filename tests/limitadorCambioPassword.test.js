import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import jwt from 'jsonwebtoken'

process.env.JWT_SECRET = 'secreto-de-prueba-con-mas-de-32-caracteres!!'
const { crearRequireAuth } = await import('../middleware/requireAuth.js')
const { limitadorCambioPassword } = await import('../middleware/rateLimit.js')

// Express de verdad, con requireAuth y el limitador reales. El controlador es
// de mentira: responde 400 y marca actualIncorrecta si el cuerpo lo pide, como
// hace handleCambiarPassword cuando la actual está mal.
// Base falsa: el usuario 7 existe con token_version 0 (los tokens de abajo no
// llevan "tv", que se lee como 0).
const dbFalsa = () => ({ select() { return this }, join() { return this }, where() { return this }, first: async () => ({ token_version: 0, cuenta_id: 1, cuenta_estado: 'activa' }) })
const requireAuth = crearRequireAuth(dbFalsa)

const app = express()
app.use(express.json())
app.post('/me/password', requireAuth, limitadorCambioPassword, (req, res) => {
    if (req.body.actual === 'mala') res.locals.actualIncorrecta = true
    res.status(req.body.actual === 'buena' ? 200 : 400).json({})
})
const servidor = app.listen(0)
const url = `http://localhost:${servidor.address().port}/me/password`

// Dos sesiones del MISMO usuario (7): tokens distintos (otro iat), como dos
// inicios de sesión en momentos diferentes.
const token = (hace) =>
    jwt.sign({ iat: Math.floor(Date.now() / 1000) - hace, tv: 0 }, process.env.JWT_SECRET, {
        subject: '7',
        audience: 'nubio-app',
        issuer: 'nubio-api',
        algorithm: 'HS256',
        expiresIn: '8h',
    })
const atacante = token(100)
const victima = token(50)

const intentar = async (tok, actual) =>
    (await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ actual }),
    })).status

test('el límite es por sesión: el atacante se bloquea y la víctima no', async () => {
    // 5 intentos con la actual equivocada, en paralelo: ninguno se cuela de más
    const primeros = await Promise.all(Array.from({ length: 5 }, () => intentar(atacante, 'mala')))
    assert.deepEqual(primeros, [400, 400, 400, 400, 400])
    assert.equal(await intentar(atacante, 'mala'), 429)
    // La víctima (mismo usuario, otra sesión) puede cambiar su contraseña
    assert.equal(await intentar(victima, 'buena'), 200)
})

test('los rechazos de la nueva (filtrada, corta) no gastan intentos', async () => {
    const otra = token(10)
    for (let i = 0; i < 8; i++) assert.equal(await intentar(otra, 'nueva-rechazada'), 400)
    assert.equal(await intentar(otra, 'buena'), 200)
})

test.after(() => servidor.close())
