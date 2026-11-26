import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import jwt from 'jsonwebtoken'

process.env.JWT_SECRET = 'secreto-de-prueba-con-mas-de-32-caracteres!!'
const { crearRequireAuth } = await import('../middleware/requireAuth.js')
const { limitadorGeneral, limitadorUsuario } = await import('../middleware/rateLimit.js')

// Express de verdad, armado como server.js: limitador general por IP para todo
// y, en las rutas con datos, requireAuth + limitador por usuario.
// Base falsa: cualquier usuario existe con token_version 0.
const dbFalsa = () => ({ select() { return this }, where() { return this }, first: async () => ({ token_version: 0 }) })
const conSesion = [crearRequireAuth(dbFalsa), limitadorUsuario]

const app = express()
app.use(limitadorGeneral)
app.get('/datos', conSesion, (req, res) => res.json({ ok: true }))
const servidor = app.listen(0)
const url = `http://localhost:${servidor.address().port}/datos`

const token = (usuario) =>
    jwt.sign({}, process.env.JWT_SECRET, { subject: String(usuario), algorithm: 'HS256', expiresIn: '8h' })

const pedir = async (tok) =>
    (await fetch(url, { headers: tok ? { Authorization: `Bearer ${tok}` } : {} })).status

// n pedidos en tandas de 50 en paralelo; devuelve cuántos dio cada status
async function pedirMuchos(n, tok) {
    const cuenta = {}
    for (let hechos = 0; hechos < n; hechos += 50) {
        const tanda = await Promise.all(Array.from({ length: Math.min(50, n - hechos) }, () => pedir(tok)))
        for (const s of tanda) cuenta[s] = (cuenta[s] ?? 0) + 1
    }
    return cuenta
}

// Todos los pedidos salen de la misma IP (localhost), como un estudio entero.

test('con sesión no se gasta el cupo de la IP: el tope es por usuario', async () => {
    // 1500 pedidos del usuario 7: más que los 500 de la IP, y pasan todos
    assert.deepEqual(await pedirMuchos(1500, token(7)), { 200: 1500 })
    // El 1501 supera el tope de ese usuario
    assert.equal(await pedir(token(7)), 429)
    // Otro usuario desde la misma IP sigue entrando
    assert.equal(await pedir(token(8)), 200)
})

test('sin sesión válida cuenta el tope por IP, y al pasarlo se frena todo', async () => {
    // Sin token y con un token inventado: 401, y cada uno gasta cupo de la IP
    assert.deepEqual(await pedirMuchos(250), { 401: 250 })
    assert.deepEqual(await pedirMuchos(250, 'no-es-un-token'), { 401: 250 })
    assert.equal(await pedir(), 429)
    // Con la IP pasada de tope, se frena aunque el pedido traiga sesión
    assert.equal(await pedir(token(9)), 429)
})

test.after(() => servidor.close())
