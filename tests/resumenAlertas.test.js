import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resumirAlertas, DIAS_URGENTE } from '../controllers/alertas.js'
import { venceOposicion, diasHabilesEntre } from '../utils/plazos.js'

// Un boletín de referencia y "hoys" elegidos para que le queden exactamente n
// días hábiles. Se buscan día por día para no depender de feriados a mano.
const BOLETIN = '2026-09-01'
const VENCE = venceOposicion(BOLETIN)
function hoyConRestantes(n) {
    const fecha = new Date(`${VENCE}T00:00:00Z`)
    for (let i = 0; i < 200; i++) {
        const texto = fecha.toISOString().slice(0, 10)
        if (diasHabilesEntre(texto, VENCE) === n) return texto
        fecha.setUTCDate(fecha.getUTCDate() + (n >= 0 ? -1 : 1))
    }
    throw new Error(`no hay fecha con ${n} días restantes`)
}

test('sin alertas nuevas: todo en cero', () => {
    assert.deepEqual(resumirAlertas([], '2026-11-25'), { nuevas: 0, urgentes: 0 })
})

test('suma las cantidades aunque pg las mande como texto', () => {
    const grupos = [
        { fecha_publicacion: '2026-11-20', cantidad: '7' },
        { fecha_publicacion: '2026-11-23', cantidad: '5' },
    ]
    // boletines recientes: les quedan casi 60 días, ninguna es urgente
    assert.deepEqual(resumirAlertas(grupos, '2026-11-25'), { nuevas: 12, urgentes: 0 })
})

test(`urgente con ${DIAS_URGENTE} días hábiles o menos, no con uno más`, () => {
    const grupos = [{ fecha_publicacion: BOLETIN, cantidad: '3' }]
    assert.deepEqual(resumirAlertas(grupos, hoyConRestantes(DIAS_URGENTE)), { nuevas: 3, urgentes: 3 })
    assert.deepEqual(resumirAlertas(grupos, hoyConRestantes(DIAS_URGENTE + 1)), { nuevas: 3, urgentes: 0 })
})

test('el día del vencimiento todavía es urgente; vencida ya no', () => {
    const grupos = [{ fecha_publicacion: BOLETIN, cantidad: 2 }]
    assert.deepEqual(resumirAlertas(grupos, VENCE), { nuevas: 2, urgentes: 2 })
    assert.deepEqual(resumirAlertas(grupos, hoyConRestantes(-1)), { nuevas: 2, urgentes: 0 })
})

test('mezcla: cuenta urgentes solo de su boletín', () => {
    const hoyPy = hoyConRestantes(5)
    const grupos = [
        { fecha_publicacion: BOLETIN, cantidad: '4' }, // 5 días: urgente
        { fecha_publicacion: hoyPy, cantidad: '9' },   // boletín de hoy: 60 días
    ]
    assert.deepEqual(resumirAlertas(grupos, hoyPy), { nuevas: 13, urgentes: 4 })
})
