import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { revisarFiltrada } from '../utils/passwordFiltrada.js'

// Los tests NO salen a internet: se reemplaza fetch por uno falso que responde
// como HIBP. Así no dependen de la red ni le pegan a un servicio externo.
const sha1 = (texto) => createHash('sha1').update(texto, 'utf8').digest('hex').toUpperCase()

function hibpFalso(respuestaPara) {
    const pedidos = []
    const fetchFn = async (url, opciones) => {
        pedidos.push({ url, opciones })
        return { ok: true, text: async () => respuestaPara(url.slice(-5)) }
    }
    return { fetchFn, pedidos }
}

const FRASE = 'tres gatos azules cantan tango'

test('a HIBP solo viajan los primeros 5 caracteres del hash, con Add-Padding', async () => {
    const { fetchFn, pedidos } = hibpFalso(() => '')
    await revisarFiltrada(FRASE, { fetchFn })
    assert.equal(pedidos.length, 1)
    assert.equal(pedidos[0].url, 'https://api.pwnedpasswords.com/range/' + sha1(FRASE).slice(0, 5))
    assert.doesNotMatch(pedidos[0].url, new RegExp(sha1(FRASE).slice(5)))
    assert.equal(pedidos[0].opciones.headers['Add-Padding'], 'true')
})

test('si HIBP la tiene con contador > 0, está filtrada', async () => {
    const resto = sha1(FRASE).slice(5)
    const { fetchFn } = hibpFalso(() => `00000AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:3\r\n${resto}:42\r\n`)
    assert.deepEqual(await revisarFiltrada(FRASE, { fetchFn }), { filtrada: true, fuente: 'hibp' })
})

test('las entradas de relleno (contador 0) no cuentan como filtradas', async () => {
    const resto = sha1(FRASE).slice(5)
    const { fetchFn } = hibpFalso(() => `${resto}:0\r\n`)
    assert.deepEqual(await revisarFiltrada(FRASE, { fetchFn }), { filtrada: false, fuente: 'hibp' })
})

test('si HIBP no responde, cae a la lista local sin bloquear el registro', async (t) => {
    t.mock.method(console, 'warn', () => {})
    const fetchFn = async () => { throw new Error('timeout') }
    assert.deepEqual(await revisarFiltrada(FRASE, { fetchFn }), { filtrada: false, fuente: 'lista-local' })
})

test('la lista local detecta contraseñas comunes (sin consultar HIBP)', async () => {
    const { fetchFn, pedidos } = hibpFalso(() => '')
    // Está en la lista (sacada de filtraciones reales); se compara sin mayúsculas.
    assert.deepEqual(await revisarFiltrada('123456789QWERTY', { fetchFn }), { filtrada: true, fuente: 'lista-local' })
    assert.equal(pedidos.length, 0)
})
