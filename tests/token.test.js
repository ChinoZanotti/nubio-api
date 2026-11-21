import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'

// Secreto solo para los tests: no depende del .env.
process.env.JWT_SECRET = 'secreto-de-prueba-con-mas-de-32-caracteres!!'

const { firmarToken, verificarToken } = await import('../utils/token.js')
const { crearRequireAuth } = await import('../middleware/requireAuth.js')
const { recordar, versionVigente, reiniciarVersiones } = await import('../utils/versionToken.js')

// --- Firma y verificación ---

test('un token firmado devuelve el id del usuario y la versión', () => {
    assert.deepEqual(verificarToken(firmarToken(42, 3)), { userId: 42, tv: 3 })
})

test('firmarToken no firma sin una versión válida', () => {
    for (const tv of [undefined, null, -1, 1.5, '0']) {
        assert.throws(() => firmarToken(42, tv), /token_version/, String(tv))
    }
})

test('un token sin "tv" (emitido antes de la columna) se lee como versión 0', () => {
    const viejo = jwt.sign({}, process.env.JWT_SECRET, { subject: '42', expiresIn: '8h' })
    assert.deepEqual(verificarToken(viejo), { userId: 42, tv: 0 })
})

test('un "tv" que no es un entero >= 0 se rechaza', () => {
    for (const tv of [-1, 1.5, '1', null]) {
        const raro = jwt.sign({ tv }, process.env.JWT_SECRET, { subject: '42', expiresIn: '8h' })
        assert.equal(verificarToken(raro), null, String(tv))
    }
})

test('un token modificado se rechaza', () => {
    // Cambiamos el payload (sub: 42 -> 1) sin volver a firmar: la firma ya no coincide.
    const [header, , firma] = firmarToken(42, 0).split('.')
    const payloadFalso = Buffer.from(JSON.stringify({ sub: '1', tv: 0 })).toString('base64url')
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

// --- requireAuth, con una base falsa ---

// users: id -> token_version. `consultas` cuenta los SELECT (para el caché).
let versiones
let consultas
beforeEach(() => {
    reiniciarVersiones()
    versiones = new Map([[7, 0]])
    consultas = 0
})
const dbFalsa = () => ({
    select() { return this },
    where({ id }) { this.id = id; return this },
    first() {
        consultas += 1
        return Promise.resolve(versiones.has(this.id) ? { token_version: versiones.get(this.id) } : undefined)
    },
})
const requireAuth = crearRequireAuth((tabla) => dbFalsa(tabla))

// Simula req/res de Express para probar el middleware sin levantar el servidor.
async function correrMiddleware(authorization) {
    const req = { headers: authorization ? { authorization } : {} }
    const res = {
        status(codigo) { this.codigo = codigo; return this },
        json(cuerpo) { this.cuerpo = cuerpo; return this },
    }
    let siguio = false
    await requireAuth(req, res, () => { siguio = true })
    return { req, res, siguio }
}

test('requireAuth deja pasar con token válido y pone req.userId', async () => {
    const { req, siguio } = await correrMiddleware(`Bearer ${firmarToken(7, 0)}`)
    assert.equal(siguio, true)
    assert.equal(req.userId, 7)
})

test('requireAuth corta con 401 sin token o con token inválido', async () => {
    for (const header of [undefined, 'Bearer', 'Bearer basura', `Basic ${firmarToken(7, 0)}`]) {
        const { res, siguio } = await correrMiddleware(header)
        assert.equal(siguio, false)
        assert.equal(res.codigo, 401)
    }
})

test('requireAuth rechaza un token de una versión anterior (contraseña cambiada)', async () => {
    const viejo = firmarToken(7, 0)
    versiones.set(7, 1)
    recordar(7, 1) // lo que hace handleCambiarPassword
    const { res, siguio } = await correrMiddleware(`Bearer ${viejo}`)
    assert.equal(siguio, false)
    assert.equal(res.codigo, 401)
    // El token nuevo sí pasa
    assert.equal((await correrMiddleware(`Bearer ${firmarToken(7, 1)}`)).siguio, true)
})

test('requireAuth rechaza el token de un usuario que ya no existe', async () => {
    const { res } = await correrMiddleware(`Bearer ${firmarToken(99, 0)}`)
    assert.equal(res.codigo, 401)
})

test('requireAuth no consulta la base en cada pedido (caché)', async () => {
    const token = `Bearer ${firmarToken(7, 0)}`
    for (let i = 0; i < 5; i++) await correrMiddleware(token)
    assert.equal(consultas, 1)
})

// --- El caché ---

test('el caché vuelve a consultar la base al vencer el TTL (30 s)', async () => {
    const db = (tabla) => dbFalsa(tabla)
    await versionVigente(db, 7, 0)
    versiones.set(7, 4) // un UPDATE a mano en la base
    assert.equal(await versionVigente(db, 7, 29_000), 0)
    assert.equal(await versionVigente(db, 7, 31_000), 4)
})

test('dentro del TTL, el caché no baja una versión (carrera con una consulta lenta)', () => {
    // Una consulta leyó 0 de la base, pero mientras esperaba se cambió la
    // contraseña y se guardó 1. Cuando llega el 0, no tiene que pisar.
    recordar(7, 1)
    recordar(7, 0)
    return versionVigente((tabla) => dbFalsa(tabla), 7).then((tv) => assert.equal(tv, 1))
})

test('vencido el TTL, el caché acepta una versión MENOR de la base (restore de Neon)', async () => {
    const db = (tabla) => dbFalsa(tabla)
    versiones.set(7, 5)
    await versionVigente(db, 7, 0)
    versiones.set(7, 2) // la base volvió atrás
    assert.equal(await versionVigente(db, 7, 10_000), 5) // dentro del TTL: todavía 5
    assert.equal(await versionVigente(db, 7, 31_000), 2) // vencido: manda la base
})
