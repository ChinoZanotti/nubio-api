import { createHash } from 'node:crypto'
import { verificarToken } from '../utils/token.js'

// Middleware: corre ANTES del controlador. Si el pedido trae un token válido
// en el header "Authorization: Bearer <token>", deja el id del usuario en
// req.userId y sigue (next). Si no, corta acá con 401 y el controlador nunca corre.
//
// A partir de esto, los controladores toman el usuario SOLO de req.userId.
// Nunca de req.body.user_id ni de req.query.user_id: eso lo escribe el cliente,
// y el cliente puede poner lo que quiera.
export function requireAuth(req, res, next) {
    const [tipo, token] = (req.headers.authorization ?? '').split(' ')
    const userId = tipo === 'Bearer' && token ? verificarToken(token) : null

    if (!userId) {
        return res.status(401).json({ error: 'Tu sesión venció. Volvé a iniciar sesión.' })
    }

    req.userId = userId
    // Id de ESTA sesión: un hash del token, nunca el token (si llegara a un
    // log, no serviría para entrar). Lo usan los limitadores que tienen que
    // contar por sesión y no por usuario (ver limitadorCambioPassword).
    req.sesionId = createHash('sha256').update(token).digest('base64url').slice(0, 16)
    next()
}
