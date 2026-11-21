import { createHash } from 'node:crypto'
import { verificarToken } from '../utils/token.js'
import { versionVigente } from '../utils/versionToken.js'

// Middleware: corre ANTES del controlador. Si el pedido trae un token válido
// en el header "Authorization: Bearer <token>", deja el id del usuario en
// req.userId y sigue (next). Si no, corta acá con 401 y el controlador nunca corre.
//
// A partir de esto, los controladores toman el usuario SOLO de req.userId.
// Nunca de req.body.user_id ni de req.query.user_id: eso lo escribe el cliente,
// y el cliente puede poner lo que quiera.
//
// Es una fábrica (recibe la base) porque además de la firma revisa que la
// versión del token siga vigente (utils/versionToken.js): si la persona cambió
// la contraseña después de que se emitió, el token ya no vale. En server.js:
//   const requireAuth = crearRequireAuth(db)
export function crearRequireAuth(db) {
    return async function requireAuth(req, res, next) {
        const [tipo, token] = (req.headers.authorization ?? '').split(' ')
        const datos = tipo === 'Bearer' && token ? verificarToken(token) : null

        if (!datos) {
            return res.status(401).json({ error: 'Tu sesión venció. Volvé a iniciar sesión.' })
        }

        // Si la consulta falla, el error sigue a manejarErrores (500): mejor que
        // dejar pasar un token sin saber si está revocado.
        const vigente = await versionVigente(db, datos.userId)
        // null: el usuario ya no existe. Distinta: cambió la contraseña después
        // de que se emitió este token. Mismo 401 que un token vencido: el
        // frontend cierra la sesión y manda al login.
        if (vigente === null || vigente !== datos.tv) {
            return res.status(401).json({ error: 'Tu sesión se cerró. Volvé a iniciar sesión.' })
        }

        req.userId = datos.userId
        // Id de ESTA sesión: un hash del token, nunca el token (si llegara a un
        // log, no serviría para entrar). Lo usan los limitadores que tienen que
        // contar por sesión y no por usuario (ver limitadorCambioPassword).
        req.sesionId = createHash('sha256').update(token).digest('base64url').slice(0, 16)
        next()
    }
}
