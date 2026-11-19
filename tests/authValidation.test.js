import { test } from 'node:test'
import assert from 'node:assert/strict'
import bcrypt from 'bcrypt'
import { validarRegistro, normalizarEmail } from '../utils/authValidation.js'

process.env.JWT_SECRET = 'secreto-de-prueba-con-mas-de-32-caracteres!!'
const { handleSignin } = await import('../controllers/signin.js')

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

test('contraseña: mínimo 10 caracteres, máximo 72 bytes', () => {
    assert.ok(validarRegistro({ ...valido, password: '123456789' }).errores.password)
    assert.equal(validarRegistro({ ...valido, password: 'a'.repeat(72) }).errores.password, undefined)
    assert.ok(validarRegistro({ ...valido, password: 'a'.repeat(73) }).errores.password)
    // 37 "ñ" son 37 letras pero 74 bytes: bcrypt ignoraría el final
    assert.ok(validarRegistro({ ...valido, password: 'ñ'.repeat(37) }).errores.password)
})

test('normalizarEmail con algo que no es texto devuelve vacío', () => {
    assert.equal(normalizarEmail(undefined), '')
    assert.equal(normalizarEmail(['a@b.com']), '')
})

// --- signin, con una "base" falsa en memoria ---
const hash = await bcrypt.hash('una-clave-larga', 4)
function dbFalsa() {
    const tablas = {
        login: [{ email: 'ana@estudio.com', hash }],
        users: [{ id: 7, name: 'Ana', email: 'ana@estudio.com', joined: '2026-01-01' }],
    }
    return (tabla) => ({
        select() { return this },
        where(filtro) { this.fila = tablas[tabla].find((f) => f.email === filtro.email); return this },
        first() { return Promise.resolve(this.fila) },
    })
}
async function signin(body) {
    const res = { status(c) { this.codigo = c; return this }, json(b) { this.cuerpo = b; return this } }
    res.codigo = 200
    await handleSignin({ body }, res, dbFalsa(), bcrypt)
    return res
}

test('signin acepta el email con mayúsculas y espacios', async () => {
    const res = await signin({ email: ' ANA@estudio.com ', password: 'una-clave-larga' })
    assert.equal(res.codigo, 200)
    assert.equal(res.cuerpo.user.id, 7)
    assert.ok(res.cuerpo.token)
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
