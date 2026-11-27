// Rutas del panel comercial (/admin/*, etapa 2). Un router aparte para que
// nada de esto se mezcle con las rutas de clientes:
// - su propio CORS (solo el origen del panel, ADMIN_FRONTEND_URL; ver
//   middleware/seguridad.js);
// - su propio middleware de sesión (requireOperador, nunca conSesion);
// - sus propios límites.
// Las rutas del panel NO consultan marcas, alertas ni boletines (revisión de
// Case, A2): el equipo comercial no ve la cartera de los clientes.
import express from 'express'
import { crearRequireOperador } from '../middleware/requireOperador.js'
import { limitadorAdminLogin, limitadorAdminCodigo, limitadorAdminActivacion, limitadorOperador } from '../middleware/rateLimit.js'
import { handleAdminSignin, handleAdminCodigo, handleAdminMe, handleAdminSalir } from '../controllers/admin/sesion.js'
import { handleVerActivacion, handleActivar } from '../controllers/admin/activacion.js'

export function crearRutasAdmin(db, bcrypt) {
    const rutas = express.Router({ caseSensitive: true })
    // Con sesión: el token y después el límite por operador (como conSesion)
    const conOperador = [crearRequireOperador(db), limitadorOperador]

    // Nada de esto se guarda en ningún caché (Case, B4): salen el secreto del
    // código, los desafíos y las sesiones.
    rutas.use((req, res, next) => {
        res.set('Cache-Control', 'no-store')
        next()
    })

    // Públicas (sin sesión)
    rutas.post('/signin', limitadorAdminLogin, (req, res) => handleAdminSignin(req, res, db, bcrypt))
    rutas.post('/signin/codigo', limitadorAdminCodigo, (req, res) => handleAdminCodigo(req, res, db))
    rutas.post('/activacion', limitadorAdminActivacion, (req, res) => handleVerActivacion(req, res, db))
    rutas.post('/activar', limitadorAdminActivacion, (req, res) => handleActivar(req, res, db, bcrypt))

    // Con sesión de operador
    rutas.get('/me', conOperador, handleAdminMe)
    rutas.post('/salir', conOperador, (req, res) => handleAdminSalir(req, res, db))

    return rutas
}
