import 'dotenv/config'
import express from 'express'
import bcrypt from 'bcrypt'
import { crearDb } from './db.js'
import { handleRegister } from './controllers/register.js'
import { handleSignin } from './controllers/signin.js'
import { handleMe } from './controllers/me.js'
import { requireAuth } from './middleware/requireAuth.js'
import { limitadorLogin, limitadorRegistro, limitadorGeneral, limitadorImportacion } from './middleware/rateLimit.js'
import { corsNubio, helmetNubio } from './middleware/seguridad.js'
import { rutaNoEncontrada, manejarErrores } from './middleware/errores.js'
import { verificarConfiguracion } from './utils/token.js'
import { handleGetMarcas, handleCreateMarca, handleCreateMarcasBulk } from './controllers/marcas.js'
import { handleGetBoletinMarcas } from './controllers/boletines.js'
import { handleGetAlertas, handleUpdateAlerta } from './controllers/alertas.js'

// Sin JWT_SECRET no se pueden firmar ni verificar tokens: cortamos al arrancar.
verificarConfiguracion()

// Conexión a Postgres: config compartida con los scripts (ver db.js).
const db = crearDb()

const app = express()

// En Render el pedido no llega directo. Medido en noviembre 2026:
//   cliente → Cloudflare → balanceador de Render (10.x) → proxy local (::1) → Express
// Cada proxy agrega a X-Forwarded-For la IP de quien le pasó el pedido. Express
// recorre la lista de derecha a izquierda salteando tantos saltos como le digamos
// que confíe: con 3 llega a la IP que escribió Cloudflare, la real del cliente.
// Con 1 se quedaba en la del balanceador, igual para todos: el rate limit
// bloqueaba a todos los usuarios juntos.
// No usar `true` ni un número mayor: confiaría en IPs que puso el cliente, que
// podría inventar una distinta en cada pedido y saltarse el límite.
// Si Render cambia su infraestructura, volver a medir (ver CLAUDE.md).
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 3))

// Orden: helmet primero (headers de seguridad en TODAS las respuestas, incluso
// errores y 429), después CORS (antes del limitador, para que el 429 lleve el
// header CORS y el frontend pueda leer el mensaje), después el limitador.
// corsNubio() lee FRONTEND_URL y corta el arranque si no está.
app.use(helmetNubio())
app.use(corsNubio())
app.use(limitadorGeneral)
app.use(express.json({ limit: '1mb' }))
// En Express 5, si el pedido no trae Content-Type: application/json, req.body
// queda undefined y cualquier `req.body.algo` tira un TypeError (500). Con un
// objeto vacío, los controladores validan como siempre y responden 400.
// Va acá, para todas las rutas: así ninguna nueva puede olvidárselo.
app.use((req, res, next) => {
    req.body ??= {}
    next()
})

app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'API funcionando' })
})

// --- Rutas públicas (no piden token) ---
// El limitador va antes del handler: si la IP se pasó, responde 429 y no se
// llega a correr bcrypt ni a tocar la base.
app.post('/signin', limitadorLogin, (req, res) => handleSignin(req, res, db, bcrypt));
app.post('/register', limitadorRegistro, (req, res) => handleRegister(req, res, db, bcrypt));

// --- Rutas protegidas ---
// requireAuth va como segundo argumento: Express lo corre antes del handler.
// Si el token falta o no es válido, responde 401 y el handler no se ejecuta.
// Toda ruta nueva que maneje datos tiene que llevarlo.

app.get('/me', requireAuth, (req, res) => handleMe(req, res, db))

// Marcas
app.get('/marcas', requireAuth, (req, res) => handleGetMarcas(req, res, db))
app.post('/marcas', requireAuth, (req, res) => handleCreateMarca(req, res, db))
// limitadorImportacion va después de requireAuth: cuenta por usuario (req.userId).
app.post('/marcas/bulk', requireAuth, limitadorImportacion, (req, res) => handleCreateMarcasBulk(req, res, db))

// Boletines DINAPI: los datos son públicos, pero la consulta es pesada.
// Se protege para que no la pueda martillar cualquiera.
app.get('/boletines/marcas', requireAuth, (req, res) => handleGetBoletinMarcas(req, res, db))

// Alertas
app.get('/alertas', requireAuth, (req, res) => handleGetAlertas(req, res, db))
app.patch('/alertas/:id', requireAuth, (req, res) => handleUpdateAlerta(req, res, db))

// --- Al final, siempre: lo que no atendió ninguna ruta ---
app.use(rutaNoEncontrada)
app.use(manejarErrores)

const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
    console.log(`App is running on port ${PORT}`)
})