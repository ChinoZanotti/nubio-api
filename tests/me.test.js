import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import bcrypt from 'bcrypt'

process.env.JWT_SECRET = 'secreto-de-prueba-con-mas-de-32-caracteres!!'
const { handleUpdateMe, handleCambiarPassword } = await import('../controllers/me.js')
const { verificarToken } = await import('../utils/token.js')
const { versionVigente, reiniciarVersiones } = await import('../utils/versionToken.js')

// --- Have I Been Pwned falso ---
// revisarFiltrada usa el fetch global si no le pasan otro. Lo reemplazamos para
// no salir a internet: responde como HIBP, marcando como filtradas las
// contraseñas de este Set.
const filtradas = new Set()
globalThis.fetch = async (url) => {
    const prefijo = url.split('/').pop()
    const lineas = [...filtradas]
        .map((p) => createHash('sha1').update(p, 'utf8').digest('hex').toUpperCase())
        .filter((h) => h.startsWith(prefijo))
        .map((h) => `${h.slice(5)}:3`)
    return { ok: true, text: async () => lineas.join('\r\n') }
}

// --- Base falsa en memoria ---
// Alcanza con lo que usan los controladores: select, where (por cualquier
// columna), first, update (con o sin returning).
const ACTUAL = 'mi clave actual de siempre'
const hashActual = await bcrypt.hash(ACTUAL, 4)
let tablas
beforeEach(() => {
    filtradas.clear()
    tablas = {
        login: [{ email: 'ana@estudio.com', hash: hashActual }],
        users: [{ id: 7, name: 'Ana Pérez', email: 'ana@estudio.com', joined: '2026-01-01', token_version: 0 }],
    }
    reiniciarVersiones()
})
function dbFalsa() {
    const db = (tabla) => ({
        select() { return this },
        where(filtro) {
            this.filas = tablas[tabla].filter((f) => Object.entries(filtro).every(([k, v]) => f[k] === v))
            return this
        },
        // Una copia, como Knex: lo leído no cambia si después cambia la tabla
        first() { return Promise.resolve(this.filas[0] && { ...this.filas[0] }) },
        update(cambios) {
            this.filas.forEach((f) => Object.assign(f, cambios))
            const promesa = Promise.resolve(this.filas.length)
            // Como Knex: devuelve solo las columnas pedidas
            promesa.returning = (cols) => Promise.resolve(this.filas.map((f) => Object.fromEntries(cols.map((c) => [c, f[c]]))))
            return promesa
        },
        increment(columna, n) {
            this.filas.forEach((f) => { f[columna] += n })
            return { returning: (col) => Promise.resolve(this.filas.map((f) => ({ [col]: f[col] }))) }
        },
    })
    // Transacción de mentira: si la función falla, se restauran las tablas.
    db.transaction = async (fn) => {
        const copia = structuredClone(tablas)
        try {
            return await fn(db)
        } catch (err) {
            Object.assign(tablas, copia)
            throw err
        }
    }
    return db
}
function resFalsa() {
    return { codigo: 200, locals: {}, status(c) { this.codigo = c; return this }, json(b) { this.cuerpo = b; return this } }
}
async function actualizar(body, userId = 7) {
    const res = resFalsa()
    await handleUpdateMe({ body, userId }, res, dbFalsa())
    return res
}
async function cambiar(body, userId = 7, bcryptUsado = bcrypt) {
    const res = resFalsa()
    await handleCambiarPassword({ body, userId, ip: '1.2.3.4' }, res, dbFalsa(), bcryptUsado)
    return res
}

test('dos cambios a la vez: gana el primero y el segundo recibe 409 sin pisarlo', async () => {
    // Mientras este pedido compara la actual, otra sesión cambia la contraseña
    // (hash nuevo y token_version 1).
    const bcryptConCambioEnElMedio = {
        ...bcrypt,
        async compare(password, hash) {
            const resultado = await bcrypt.compare(password, hash)
            tablas.login[0].hash = 'hash-del-primer-cambio'
            tablas.users[0].token_version = 1
            return resultado
        },
    }
    const res = await cambiar({ currentPassword: ACTUAL, newPassword: NUEVA }, 7, bcryptConCambioEnElMedio)
    assert.equal(res.codigo, 409)
    assert.equal(res.cuerpo.token, undefined)
    assert.equal(tablas.login[0].hash, 'hash-del-primer-cambio')
    assert.equal(tablas.users[0].token_version, 1)
})

// --- PATCH /me ---

test('PATCH /me cambia el nombre (recortado) y devuelve solo las columnas públicas', async () => {
    const res = await actualizar({ name: '  Ana María  ' })
    assert.equal(res.codigo, 200)
    assert.deepEqual(res.cuerpo, { id: 7, name: 'Ana María', email: 'ana@estudio.com', joined: '2026-01-01' })
    assert.equal(tablas.users[0].name, 'Ana María')
})

test('PATCH /me rechaza nombre vacío, demasiado largo o que no es texto', async () => {
    for (const name of ['   ', 'A'.repeat(101), ['Ana'], undefined]) {
        const res = await actualizar({ name })
        assert.equal(res.codigo, 400, String(name))
        assert.ok(res.cuerpo.errores.name)
    }
    assert.equal(tablas.users[0].name, 'Ana Pérez')
})

test('PATCH /me rechaza caracteres invisibles (nulo, salto de línea, U+202E) con 400', async () => {
    for (const name of ['Ana\u0000', 'Ana\nPérez', 'Ana‮zepér']) {
        const res = await actualizar({ name })
        assert.equal(res.codigo, 400, JSON.stringify(name))
    }
    // Tildes, apóstrofos tipográficos y emojis siguen valiendo
    for (const name of ['José Núñez', 'Seán O’Brien', 'Ana 😀']) {
        assert.equal((await actualizar({ name })).codigo, 200, name)
    }
})

test('PATCH /me ignora otros campos: no se puede cambiar el email ni el id', async () => {
    await actualizar({ name: 'Ana', email: 'otro@x.com', id: 1 })
    assert.equal(tablas.users[0].email, 'ana@estudio.com')
    assert.equal(tablas.users[0].id, 7)
})

// --- POST /me/password ---

const NUEVA = 'tres palabras largas juntas'

test('cambia la contraseña: la nueva entra con costo 12 y la vieja ya no', async () => {
    const res = await cambiar({ currentPassword: ACTUAL, newPassword: NUEVA })
    assert.equal(res.codigo, 200)
    const { hash } = tablas.login[0]
    assert.equal(bcrypt.getRounds(hash), 12)
    assert.ok(await bcrypt.compare(NUEVA, hash))
    assert.equal(await bcrypt.compare(ACTUAL, hash), false)
})

test('al cambiarla sube token_version y devuelve un token nuevo con esa versión', async () => {
    const res = await cambiar({ currentPassword: ACTUAL, newPassword: NUEVA })
    assert.equal(tablas.users[0].token_version, 1)
    assert.deepEqual(verificarToken(res.cuerpo.token), { userId: 7, tv: 1 })
    // Y el caché ya lo sabe: los tokens viejos (tv 0) dan 401 desde ahora
    assert.equal(await versionVigente(() => { throw new Error('no debería consultar la base') }, 7), 1)
})

test('un intento rechazado no cierra las otras sesiones', async () => {
    await cambiar({ currentPassword: 'no es la actual para nada', newPassword: NUEVA })
    filtradas.add(NUEVA)
    await cambiar({ currentPassword: ACTUAL, newPassword: NUEVA })
    assert.equal(tablas.users[0].token_version, 0)
})

test('con la contraseña actual equivocada no cambia nada', async () => {
    const res = await cambiar({ currentPassword: 'no es la actual para nada', newPassword: NUEVA })
    assert.equal(res.codigo, 400)
    assert.ok(res.cuerpo.errores.currentPassword)
    assert.equal(tablas.login[0].hash, hashActual)
})

// El limitador cuenta solo los pedidos con res.locals.actualIncorrecta.
test('solo la actual equivocada se marca como intento fallido', async () => {
    const mala = await cambiar({ currentPassword: 'no es la actual para nada', newPassword: NUEVA })
    assert.equal(mala.locals.actualIncorrecta, true)
    filtradas.add(NUEVA)
    const filtrada = await cambiar({ currentPassword: ACTUAL, newPassword: NUEVA })
    assert.equal(filtrada.codigo, 400)
    assert.equal(filtrada.locals.actualIncorrecta, undefined)
    const corta = await cambiar({ currentPassword: ACTUAL, newPassword: 'corta' })
    assert.equal(corta.locals.actualIncorrecta, undefined)
})

// Con el nombre y el correo del usuario del token (Ana Pérez): el cliente no
// los manda, los busca el servidor.
test('la nueva sigue la política: largo, nombre y app', async () => {
    for (const newPassword of ['corta', 'la clave de PEREZ siempre', 'mi clave de nubio larga']) {
        const res = await cambiar({ currentPassword: ACTUAL, newPassword })
        assert.equal(res.codigo, 400, newPassword)
        assert.ok(res.cuerpo.errores.newPassword, newPassword)
    }
    assert.equal(tablas.login[0].hash, hashActual)
})

test('una nueva filtrada se rechaza en su campo', async () => {
    filtradas.add(NUEVA)
    const res = await cambiar({ currentPassword: ACTUAL, newPassword: NUEVA })
    assert.equal(res.codigo, 400)
    assert.match(res.cuerpo.errores.newPassword, /filtraciones/)
    assert.equal(tablas.login[0].hash, hashActual)
})

test('sin la actual, o con tipos raros, da 400 sin romper', async () => {
    for (const body of [{ newPassword: NUEVA }, { currentPassword: [ACTUAL], newPassword: NUEVA }, {}, null]) {
        const res = await cambiar(body)
        assert.equal(res.codigo, 400, JSON.stringify(body))
    }
    assert.equal(tablas.login[0].hash, hashActual)
})

test('una "actual" enorme se rechaza sin pasarla por bcrypt', async () => {
    const res = await cambiar({ currentPassword: 'x'.repeat(5000), newPassword: NUEVA })
    assert.equal(res.codigo, 400)
    assert.ok(res.cuerpo.errores.currentPassword)
})

test('solo toca la contraseña del usuario del token', async () => {
    tablas.login.push({ email: 'otro@estudio.com', hash: 'hash-del-otro' })
    await cambiar({ currentPassword: ACTUAL, newPassword: NUEVA })
    assert.equal(tablas.login[1].hash, 'hash-del-otro')
})
