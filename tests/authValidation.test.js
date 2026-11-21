import { test } from 'node:test'
import assert from 'node:assert/strict'
import bcrypt from 'bcrypt'
import { validarRegistro, validarPassword, contarCaracteres, normalizarEmail } from '../utils/authValidation.js'

process.env.JWT_SECRET = 'secreto-de-prueba-con-mas-de-32-caracteres!!'
const { handleSignin } = await import('../controllers/signin.js')
const { verificarToken } = await import('../utils/token.js')

const valido = { name: 'Ana Pérez', email: 'ana@estudio.com', password: 'una-clave-larga' }

test('un registro válido no tiene errores y normaliza los datos', () => {
    const { datos, errores } = validarRegistro({ ...valido, name: '  Ana Pérez ', email: '  Ana@Estudio.COM ' })
    assert.deepEqual(errores, {})
    assert.equal(datos.name, 'Ana Pérez')
    assert.equal(datos.email, 'ana@estudio.com')
})

test('la contraseña no se recorta: los espacios son parte de ella', () => {
    const { datos } = validarRegistro({ ...valido, password: ' clave con espacio ' })
    assert.equal(datos.password, ' clave con espacio ')
})

test('tipos que no son texto se rechazan (no pasan el chequeo de largo por accidente)', () => {
    const { errores } = validarRegistro({ name: ['x'], email: { a: 1 }, password: Array(10).fill('a') })
    assert.ok(errores.name && errores.email && errores.password)
})

test('email con formato inválido o demasiado largo se rechaza', () => {
    for (const email of ['sin-arroba', 'a@b', 'con espacio@x.com', `${'a'.repeat(250)}@x.com`]) {
        assert.ok(validarRegistro({ ...valido, email }).errores.email, email)
    }
})

test('nombre de más de 100 caracteres se rechaza', () => {
    assert.ok(validarRegistro({ ...valido, name: 'A'.repeat(101) }).errores.name)
    assert.equal(validarRegistro({ ...valido, name: 'A'.repeat(100) }).errores.name, undefined)
})

test('contraseña: mínimo 15 caracteres, máximo 72 bytes', () => {
    assert.match(validarPassword('a'.repeat(14)), /Te falta 1 carácter/)
    assert.match(validarPassword('a'.repeat(11)), /Te faltan 4 caracteres/)
    assert.equal(validarPassword('a'.repeat(15)), null)
    assert.equal(validarPassword('a'.repeat(72)), null)
    assert.match(validarPassword('a'.repeat(73)), /demasiado larga/)
    // 37 "ñ" son 37 letras pero 74 bytes: bcrypt ignoraría el final
    assert.match(validarPassword('ñ'.repeat(37)), /demasiado larga/)
})

test('se cuentan caracteres reales, no unidades UTF-16 (un emoji es 1)', () => {
    assert.equal(contarCaracteres('😀'), 1)
    assert.equal('😀'.length, 2) // por esto no alcanzaba con .length
    // 14 letras + 1 emoji = 15 caracteres reales (aunque .length dé 16)
    assert.equal(validarPassword('a'.repeat(14) + '😀'), null)
    // 13 letras + 1 emoji = 14: con .length (15) habría pasado por error
    assert.match(validarPassword('a'.repeat(13) + '😀'), /Te falta 1 carácter/)
})

test('rechaza contraseñas con el nombre, el correo o el nombre de la app', () => {
    const usuario = { name: 'María José Pérez', email: 'mjperez@estudio.com' }
    for (const password of [
        'mi cuenta de NUBIO 2026',      // la app, en mayúsculas
        'consultas en dinapi siempre',  // el otro término de la app
        'la contraseña de mjperez!!',   // la parte del correo
        'maria juega al fútbol',        // el nombre, escrito sin tilde
        'el gato de PEREZ es negro',    // el apellido
    ]) {
        assert.match(validarPassword(password, usuario), /fácil de adivinar/, password)
    }
    // "José" tiene 4 letras y entra; "Ana" (3) no se busca: aparecería por casualidad
    assert.equal(validarPassword('una banana en la ventana', { name: 'Ana' }), null)
})

test('normalizarEmail con algo que no es texto devuelve vacío', () => {
    assert.equal(normalizarEmail(undefined), '')
    assert.equal(normalizarEmail(['a@b.com']), '')
})

// --- signin, con una "base" falsa en memoria ---
// Costo 4 (no 12) para que los tests sean rápidos; además sirve para probar
// que signin recalcula los hashes de costo menor.
const hash = await bcrypt.hash('una-clave-larga', 4)
function dbFalsa(tablas) {
    // where acepta { email }, { 'login.email': email } o { email, hash }.
    // join('users', ...) une a cada fila de login la de users con su email.
    return (tabla) => ({
        select() { return this },
        join() { this.unir = true; return this },
        where(filtro) {
            const email = filtro.email ?? filtro['login.email']
            this.fila = tablas[tabla].find((f) => f.email === email && (filtro.hash === undefined || f.hash === filtro.hash))
            return this
        },
        first() {
            if (!this.fila || !this.unir) return Promise.resolve(this.fila && { ...this.fila })
            const user = tablas.users.find((u) => u.email === this.fila.email)
            return Promise.resolve(user && { ...user, hash: this.fila.hash })
        },
        update(cambios) {
            if (!this.fila) return Promise.resolve(0)
            Object.assign(this.fila, cambios)
            return Promise.resolve(1)
        },
    })
}
function tablasNuevas() {
    return {
        login: [{ email: 'ana@estudio.com', hash }],
        users: [{ id: 7, name: 'Ana', email: 'ana@estudio.com', joined: '2026-01-01', token_version: 3 }],
    }
}
async function signin(body, tablas = tablasNuevas(), bcryptUsado = bcrypt) {
    const res = { status(c) { this.codigo = c; return this }, json(b) { this.cuerpo = b; return this } }
    res.codigo = 200
    await handleSignin({ body }, res, dbFalsa(tablas), bcryptUsado)
    return res
}

// Simula que la dueña cambia la contraseña MIENTRAS bcrypt compara (~250 ms):
// la ventana de las carreras de la revisión de Case de I3.
function bcryptConCambioEnElMedio(tablas) {
    return {
        ...bcrypt,
        async compare(password, hash) {
            const resultado = await bcrypt.compare(password, hash)
            tablas.login[0].hash = 'hash-de-la-contraseña-nueva'
            tablas.users[0].token_version += 1
            return resultado
        },
    }
}

test('signin con la contraseña vieja durante un cambio: el token sale con la versión VIEJA', async () => {
    const tablas = tablasNuevas()
    const res = await signin({ email: 'ana@estudio.com', password: 'una-clave-larga' }, tablas, bcryptConCambioEnElMedio(tablas))
    assert.equal(res.codigo, 200)
    // La versión es la que se leyó junto con el hash (3), no la nueva (4):
    // requireAuth lo rechaza apenas lo use.
    assert.equal(verificarToken(res.cuerpo.token).tv, 3)
})

test('el rehash no pisa una contraseña que cambió mientras tanto', async () => {
    const tablas = tablasNuevas() // hash de costo 4: signin intenta el rehash
    await signin({ email: 'ana@estudio.com', password: 'una-clave-larga' }, tablas, bcryptConCambioEnElMedio(tablas))
    assert.equal(tablas.login[0].hash, 'hash-de-la-contraseña-nueva')
})

test('signin no le manda el hash al cliente', async () => {
    const res = await signin({ email: 'ana@estudio.com', password: 'una-clave-larga' })
    assert.equal('hash' in res.cuerpo.user, false)
})

test('signin recalcula con costo 12 un hash viejo de costo menor', async () => {
    const tablas = tablasNuevas()
    assert.equal(bcrypt.getRounds(tablas.login[0].hash), 4)
    const res = await signin({ email: 'ana@estudio.com', password: 'una-clave-larga' }, tablas)
    assert.equal(res.codigo, 200)
    assert.equal(bcrypt.getRounds(tablas.login[0].hash), 12)
    assert.ok(await bcrypt.compare('una-clave-larga', tablas.login[0].hash))
})

test('signin NO aplica la política nueva: una contraseña vieja de 11 caracteres sigue entrando', async () => {
    const tablas = tablasNuevas()
    tablas.login[0].hash = await bcrypt.hash('clave-vieja', 4)
    assert.equal((await signin({ email: 'ana@estudio.com', password: 'clave-vieja' }, tablas)).codigo, 200)
})

test('signin acepta el email con mayúsculas y espacios', async () => {
    const res = await signin({ email: ' ANA@estudio.com ', password: 'una-clave-larga' })
    assert.equal(res.codigo, 200)
    assert.equal(res.cuerpo.user.id, 7)
    assert.ok(res.cuerpo.token)
})

test('signin firma el token con la token_version del usuario y no se la manda al cliente', async () => {
    const res = await signin({ email: 'ana@estudio.com', password: 'una-clave-larga' })
    assert.deepEqual(verificarToken(res.cuerpo.token), { userId: 7, tv: 3 })
    assert.equal('token_version' in res.cuerpo.user, false)
})

test('signin: email inexistente y contraseña mala dan el MISMO error', async () => {
    const noExiste = await signin({ email: 'nadie@x.com', password: 'una-clave-larga' })
    const claveMala = await signin({ email: 'ana@estudio.com', password: 'otra-clave-larga' })
    assert.equal(noExiste.codigo, 400)
    assert.deepEqual(noExiste.cuerpo, claveMala.cuerpo)
})

test('signin rechaza tipos raros sin romper', async () => {
    for (const body of [{}, { email: 'ana@estudio.com', password: ['una-clave-larga'] }, { email: 5, password: 'x' }]) {
        assert.equal((await signin(body)).codigo, 400)
    }
})
