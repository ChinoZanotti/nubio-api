import 'dotenv/config'
import express from 'express'
import bcrypt, { hash } from 'bcrypt'
import cors from 'cors'
import knex from 'knex'
import { handleRegister } from './controllers/register.js'
import { handleSignin } from './controllers/signin.js'
import { handleProfile } from './controllers/projile.js'
import pg from 'pg'

// ...
import { handleGetMarcas, handleCreateMarca, handleCreateMarcasBulk } from './controllers/marcas.js'
import { handleGetBoletinMarcas } from './controllers/boletines.js'

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

app.use(cors())
app.use(express.json({ limit: '1mb' }))

app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'API funcionando' })
})

// --- Signin ---
app.post('/signin', (req, res) => handleSignin(req, res, db, bcrypt));

// --- Register ---
app.post('/register', (req, res) => handleRegister(req, res, db, bcrypt));

// --- Profile ---
app.get('/profile/:id', (req, res) => handleProfile(req, res, db));

// --- Marcas ---
app.get('/marcas', (req, res) => handleGetMarcas(req, res, db))
app.post('/marcas', (req, res) => handleCreateMarca(req, res, db))
app.post('/marcas/bulk', (req, res) => handleCreateMarcasBulk(req, res, db))

// --- Boletines DINAPI ---
app.get('/boletines/marcas', (req, res) => handleGetBoletinMarcas(req, res, db))

const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
    console.log(`App is running on port ${PORT}`)
})