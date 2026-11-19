import 'dotenv/config'
import express from 'express'
import bcrypt from 'bcrypt'
import cors from 'cors'
import knex from 'knex'
import { handleRegister } from './controllers/register.js'
import { handleSignin } from './controllers/signin.js'
import { handleMe } from './controllers/me.js'
import { requireAuth } from './middleware/requireAuth.js'
import { limitadorLogin, limitadorRegistro, limitadorGeneral } from './middleware/rateLimit.js'
import { verificarConfiguracion } from './utils/token.js'
import pg from 'pg'

// ...
import { handleGetMarcas, handleCreateMarca, handleCreateMarcasBulk } from './controllers/marcas.js'
import { handleGetBoletinMarcas } from './controllers/boletines.js'
import { handleGetAlertas, handleUpdateAlerta } from './controllers/alertas.js'

// Sin JWT_SECRET no se pueden firmar ni verificar tokens: cortamos al arrancar.
verificarConfiguracion()

// Postgres DATE (OID 1082) -> string "aaaa-mm-dd" tal cual, sin convertir a Date de JS.
pg.types.setTypeParser(1082, (valor) => valor)

const db = knex({
  client: 'pg',
  connection: {
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('neon.tech')
      ? { rejectUnauthorized: false }
      : false,
  },
})

const app = express()

// En Render el pedido no llega directo: pasa por un proxy, y para Express la IP
// de origen sería siempre la del proxy. Con esto Express toma la IP real del
// header X-Forwarded-For, confiando en UN salto (el proxy de Render). Sin esto,
// el rate limit trataría a todos los usuarios como una sola IP y bloquearía a todos juntos.
// No usar `true`: confiaría en cualquier X-Forwarded-For, y el cliente puede
// mandar uno inventado para cambiar de "IP" en cada pedido y saltarse el límite.
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1))

app.use(cors())
app.use(limitadorGeneral)
app.use(express.json({ limit: '1mb' }))

app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'API funcionando' })
})

// TEMPORAL: diagnóstico de la cadena de proxies de Render para ajustar TRUST_PROXY.
// Solo le devuelve a quien llama SUS PROPIOS datos de conexión. Borrar después de usarlo.
app.get('/debug/ip', (req, res) => {
    res.json({
        ip_que_ve_express: req.ip,
        trust_proxy: app.get('trust proxy'),
        x_forwarded_for: req.headers['x-forwarded-for'] ?? null,
        ip_del_socket: req.socket.remoteAddress,
        cf_connecting_ip: req.headers['cf-connecting-ip'] ?? null,
        true_client_ip: req.headers['true-client-ip'] ?? null,
        x_real_ip: req.headers['x-real-ip'] ?? null,
    })
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
app.post('/marcas/bulk', requireAuth, (req, res) => handleCreateMarcasBulk(req, res, db))

// Boletines DINAPI: los datos son públicos, pero la consulta es pesada.
// Se protege para que no la pueda martillar cualquiera.
app.get('/boletines/marcas', requireAuth, (req, res) => handleGetBoletinMarcas(req, res, db))

// Alertas
app.get('/alertas', requireAuth, (req, res) => handleGetAlertas(req, res, db))
app.patch('/alertas/:id', requireAuth, (req, res) => handleUpdateAlerta(req, res, db))

const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
    console.log(`App is running on port ${PORT}`)
})