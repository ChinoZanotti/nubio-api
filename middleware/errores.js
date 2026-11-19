import { registrarError } from '../utils/log.js'

// Respuestas para lo que no llega a ningún controlador.
//
// Sin esto, Express responde con su página HTML por defecto. Ante un JSON mal
// formado, esa página incluye el stack trace completo (rutas internas del
// servidor, versiones de librerías) salvo que NODE_ENV sea "production".
// Para un atacante, eso es un mapa del servidor. Con estos handlers la API
// responde siempre JSON y sin detalles internos, sea cual sea NODE_ENV.

// Va después de todas las rutas: si ninguna respondió, la ruta no existe.
export function rutaNoEncontrada(req, res) {
    res.status(404).json({ error: 'Ruta no encontrada.' })
}

// Express reconoce un manejador de errores porque recibe CUATRO parámetros
// (err, req, res, next). Aunque `next` no se use, tiene que estar.
// En Express 5, un error dentro de un handler async también llega acá.
// eslint-disable-next-line no-unused-vars
export function manejarErrores(err, req, res, next) {
    // Errores de express.json() al leer el body: son del cliente, no del servidor.
    if (err.type === 'entity.parse.failed') {
        return res.status(400).json({ error: 'El cuerpo del pedido no es un JSON válido.' })
    }
    if (err.type === 'entity.too.large') {
        return res.status(413).json({ error: 'El pedido es demasiado grande.' })
    }

    // Cualquier otro error: al log va lo necesario para investigar, nunca
    // err.detail (Postgres pone ahí datos como emails). Al cliente, nada interno.
    registrarError(`${req.method} ${req.path}`, err)
    const estado = Number.isInteger(err.status) && err.status >= 400 && err.status < 500 ? err.status : 500
    res.status(estado).json({ error: estado === 500 ? 'Error en el servidor.' : 'Pedido inválido.' })
}
