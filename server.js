import express from 'express'
import bcrypt, { hash } from 'bcrypt'
import cors from 'cors'
import knex from 'knex'
import { handleRegister } from './controllers/register.js'
import { handleSignin } from './controllers/signin.js'
import { handleProfile } from './controllers/projile.js'
import { handleMarcas } from './controllers/marcas.js'

const db = knex({
  client: 'pg',
  connection: {
    host: '127.0.0.1',
    port: 5432,
    user: 'postgres',
    password: 'C$oEeE1029',
    database: 'nubio',
  },
})

const app = express()

app.use(cors())
app.use(express.json())

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
app.put( '/marcas', (req, res) => handleMarcas(req, res, db));

const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
    console.log(`App is running on port ${PORT}`)
})