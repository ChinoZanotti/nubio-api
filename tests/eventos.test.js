import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.JWT_SECRET = 'secreto-de-prueba-con-mas-de-32-caracteres!!'
const { registrarEvento, codigoDeCuenta } = await import('../utils/eventos.js')

// Los tests pasan su propia función `escribir` para capturar la línea.
function capturar(evento, datos) {
    let linea
    registrarEvento(evento, datos, (texto) => { linea = texto })
    return linea
}

test('una línea con la marca [seguridad] y JSON adentro', () => {
    const linea = capturar('login_fallido', { email: 'ana@estudio.com', ip: '203.0.113.9' })
    assert.match(linea, /^\[seguridad\] \{/)
    const datos = JSON.parse(linea.slice('[seguridad] '.length))
    assert.equal(datos.evento, 'login_fallido')
    assert.equal(datos.ip, '203.0.113.9')
    assert.ok(datos.ts)
})

test('el email NUNCA aparece en claro: va como código de cuenta', () => {
    const linea = capturar('login_fallido', { email: 'ana@estudio.com' })
    assert.doesNotMatch(linea, /ana@estudio\.com/)
    assert.doesNotMatch(linea, /"email"/)
    assert.match(linea, /"cuenta":"[\w-]{16}"/)
})

test('el código de cuenta es estable por email (para cruzar eventos) y distinto entre emails', () => {
    assert.equal(codigoDeCuenta('ana@estudio.com'), codigoDeCuenta('ana@estudio.com'))
    assert.notEqual(codigoDeCuenta('ana@estudio.com'), codigoDeCuenta('beto@estudio.com'))
})

test('sin email, no hay campo cuenta', () => {
    const linea = capturar('limite_superado', { limitador: 'general', ip: '1.2.3.4' })
    assert.doesNotMatch(linea, /"cuenta"/)
})
