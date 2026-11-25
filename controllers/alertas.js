import { registrarError } from '../utils/log.js'
import { hoy, venceOposicion, diasHabilesEntre } from '../utils/plazos.js'

const ESTADOS = ['nueva', 'en_revision', 'a_oponer', 'descartada']
const LARGO_MAXIMO_NOTA = 2000

// Entero positivo o null. Solo para el id de la alerta (viene en la URL):
// el usuario sale de req.userId, que pone el middleware requireAuth.
function parseId(valor) {
    const id = Number(valor)
    return Number.isInteger(id) && id > 0 ? id : null
}

// Filas planas: los datos de mi marca llevan prefijo "mi_" y los del boletín
// usan los mismos nombres que en /boletines/marcas.
const COLUMNAS = [
    'a.id', 'a.score', 'a.nivel', 'a.motivos', 'a.relacion_clase', 'a.estado', 'a.nota', 'a.created_at',
    'm.id as mi_marca_id', 'm.denominacion as mi_denominacion', 'm.clase_niza as mi_clase_niza', 'm.expediente as mi_expediente',
    'b.denominacion', 'b.clase_niza', 'b.expediente', 'b.signo', 'b.titular', 'b.pais', 'b.agente', 'b.fecha_publicacion',
]

export const handleGetAlertas = async (req, res, db) => {
    const { userId } = req

    try {
        const filas = await db('alertas as a')
            .join('marcas as m', 'm.id', 'a.marca_id')
            .join('boletin_marcas as b', 'b.id', 'a.boletin_marca_id')
            .select(COLUMNAS)
            .where('m.user_id', userId)
            // las nuevas primero; dentro de cada estado, las más parecidas
            .orderByRaw(`a.estado = 'nueva' desc, a.score desc, b.fecha_publicacion desc`)

        // El plazo se calcula acá y no en SQL porque depende de los feriados.
        // Muchas alertas comparten fecha de vencimiento: los días restantes se
        // calculan una vez por vencimiento (venceOposicion ya tiene su memoria).
        const hoyPy = hoy()
        const restantes = new Map()
        const alertas = filas.map((f) => {
            const vence = venceOposicion(f.fecha_publicacion)
            if (!restantes.has(vence)) restantes.set(vence, diasHabilesEntre(hoyPy, vence))
            return { ...f, vence_oposicion: vence, dias_habiles_restantes: restantes.get(vence) }
        })
        res.json(alertas)
    } catch (err) {
        registrarError('GET /alertas', err)
        res.status(500).json({ error: 'No se pudieron obtener las alertas.' })
    }
}

// Una alerta nueva es urgente si le quedan entre 0 y DIAS_URGENTE días hábiles
// para oponerse. Es la misma regla que DIAS_URGENTE de Alertas.jsx (frontend):
// si cambia, cambiarla en los dos. Las vencidas no cuentan: ya no hay nada que hacer.
export const DIAS_URGENTE = 10

// grupos: [{ fecha_publicacion, cantidad }] con las alertas NUEVAS del usuario,
// contadas por fecha de boletín. Devuelve { nuevas, urgentes }.
// Función pura (sin base) para poder probarla con cualquier "hoy".
export function resumirAlertas(grupos, hoyPy) {
    let nuevas = 0
    let urgentes = 0
    for (const { fecha_publicacion, cantidad } of grupos) {
        const n = Number(cantidad) // pg devuelve count() como texto (bigint)
        nuevas += n
        const dias = diasHabilesEntre(hoyPy, venceOposicion(fecha_publicacion))
        if (dias >= 0 && dias <= DIAS_URGENTE) urgentes += n
    }
    return { nuevas, urgentes }
}

// GET /alertas/resumen: lo que necesita el contador del menú, sin traer las
// alertas. La base devuelve una fila por fecha de boletín (pocas, porque las
// alertas llegan en tandas) y el plazo se calcula una vez por fecha.
export const handleResumenAlertas = async (req, res, db) => {
    const { userId } = req

    try {
        const grupos = await db('alertas as a')
            .join('marcas as m', 'm.id', 'a.marca_id')
            .join('boletin_marcas as b', 'b.id', 'a.boletin_marca_id')
            .where('m.user_id', userId)
            .where('a.estado', 'nueva')
            .groupBy('b.fecha_publicacion')
            .select('b.fecha_publicacion')
            .count('* as cantidad')

        res.json(resumirAlertas(grupos, hoy()))
    } catch (err) {
        registrarError('GET /alertas/resumen', err)
        res.status(500).json({ error: 'No se pudo obtener el resumen de alertas.' })
    }
}

export const handleUpdateAlerta = async (req, res, db) => {
    const { userId } = req
    const id = parseId(req.params.id)
    if (!id) {
        return res.status(400).json({ error: 'Parámetros inválidos.' })
    }

    // Solo se pueden cambiar estado y nota: el resto lo calcula el motor.
    const cambios = {}
    if (req.body.estado !== undefined) {
        if (!ESTADOS.includes(req.body.estado)) {
            return res.status(400).json({ error: 'Estado inválido.' })
        }
        cambios.estado = req.body.estado
    }
    if (req.body.nota !== undefined) {
        const nota = String(req.body.nota ?? '').trim()
        if (nota.length > LARGO_MAXIMO_NOTA) {
            return res.status(400).json({ error: `La nota puede tener hasta ${LARGO_MAXIMO_NOTA} caracteres.` })
        }
        cambios.nota = nota || null
    }
    if (Object.keys(cambios).length === 0) {
        return res.status(400).json({ error: 'No hay cambios.' })
    }

    try {
        // El WHERE con subconsulta asegura que la alerta sea de una marca del usuario.
        // Si no lo es, no se actualiza nada y respondemos 404 (sin revelar si existe).
        const [actualizada] = await db('alertas')
            .where({ id })
            .whereIn('marca_id', db('marcas').select('id').where({ user_id: userId }))
            .update({ ...cambios, updated_at: db.fn.now() })
            .returning(['id', 'estado', 'nota'])

        if (!actualizada) {
            return res.status(404).json({ error: 'Alerta no encontrada.' })
        }
        res.json(actualizada)
    } catch (err) {
        registrarError('PATCH /alertas', err)
        res.status(500).json({ error: 'No se pudo actualizar la alerta.' })
    }
}
