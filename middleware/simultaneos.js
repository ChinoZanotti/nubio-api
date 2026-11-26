// Tope de trabajos EN CURSO a la vez por usuario (revisión de Case de los
// límites, M1, noviembre 2026).
//
// Los limitadores de express-rate-limit cuentan pedidos por ventana de tiempo,
// pero no frenan ráfagas: 180 búsquedas pueden llegar en el mismo segundo. Cada
// búsqueda de Boletines abre 3 consultas, y el pool de knex tiene 10
// conexiones: con una ráfaga, el login y requireAuth de las demás personas
// esperan su turno. Con este tope, un usuario nunca ocupa más de unas pocas
// conexiones y siempre quedan libres para el resto.
//
// Se cuenta hasta que TERMINA el trabajo (el `finally`), no hasta que se cierra
// la conexión con el navegador: cuando el frontend cancela una búsqueda vieja,
// el navegador corta, pero la consulta en Postgres sigue corriendo y sigue
// ocupando su conexión. Contarla hasta el final es lo que protege el pool.
//
// Uso: `crearLimiteSimultaneo({ maximo, mensaje })` devuelve una función
// `(req, res, trabajo)`; `trabajo` es el controlador (async). Va después de
// requireAuth: usa req.userId. Vive en memoria, como los demás limitadores.

export function crearLimiteSimultaneo({ maximo, mensaje }) {
    const enCurso = new Map() // userId -> cantidad en curso

    return async function conTurno(req, res, trabajo) {
        const usuario = req.userId
        const actuales = enCurso.get(usuario) ?? 0
        if (actuales >= maximo) {
            return res.status(429).json({ error: mensaje })
        }
        // Revisar y sumar sin `await` en el medio: dos pedidos que llegan juntos
        // no pueden pasar los dos con el último lugar.
        enCurso.set(usuario, actuales + 1)
        try {
            await trabajo()
        } finally {
            const restantes = enCurso.get(usuario) - 1
            if (restantes > 0) enCurso.set(usuario, restantes)
            else enCurso.delete(usuario)
        }
    }
}
