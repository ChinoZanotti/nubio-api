// Middleware de las rutas del panel comercial (/admin/*), el equivalente de
// requireAuth para operadores (etapa 2). Nunca se mezclan: las rutas de
// clientes no aceptan tokens de operador y estas no aceptan tokens de cliente
// (otra clave y otra audiencia, ver utils/tokenOperador.js).
//
// Deja req.operadorId y req.operador ({ id, nombre, email }). Sin caché, a
// diferencia de requireAuth: son pocas personas y pocos pedidos, y así
// desactivar o resetear a un operador corta su sesión en el pedido siguiente,
// sin esperar 30 s, en cualquier instancia.
import { verificarTokenOperador, AUD_SESION } from '../utils/tokenOperador.js'

const NO_AUTORIZADO = { error: 'Tu sesión del panel venció. Volvé a iniciar sesión.' }

export function crearRequireOperador(db) {
    return async function requireOperador(req, res, next) {
        const [tipo, token] = (req.headers.authorization ?? '').split(' ')
        const datos = tipo === 'Bearer' && token ? verificarTokenOperador(token, AUD_SESION) : null
        if (!datos) return res.status(401).json(NO_AUTORIZADO)

        // Si la consulta falla, el error sigue a manejarErrores (500): mejor
        // que dejar pasar sin saber.
        const operador = await db('operadores')
            .where({ id: datos.operadorId })
            .first('id', 'nombre', 'email', 'token_version', 'activo', 'hash')
        // Desactivado, sin activar (sin contraseña) o con la versión cambiada
        // (lo resetearon): afuera.
        if (!operador || !operador.activo || !operador.hash || operador.token_version !== datos.tv) {
            return res.status(401).json(NO_AUTORIZADO)
        }
        req.operadorId = operador.id
        req.operador = { id: operador.id, nombre: operador.nombre, email: operador.email }
        next()
    }
}
