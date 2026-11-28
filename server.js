import 'dotenv/config'
import express from 'express'
import bcrypt from 'bcrypt'
import { crearDb } from './db.js'
import { handleRegister } from './controllers/register.js'
import { handleSignin } from './controllers/signin.js'
import { handleMe, handleUpdateMe, handleCambiarPassword } from './controllers/me.js'
import { crearRequireAuth } from './middleware/requireAuth.js'
import { limitadorActivacionCuenta, limitadorLogin, limitadorRegistro, limitadorGeneral, limitadorUsuario, limitadorImportacion, limitadorBoletines, limitadorBoletinesSesion, limitadorCambioPassword, limitadorEscrituraMarcas } from './middleware/rateLimit.js'
import { crearLimiteSimultaneo } from './middleware/simultaneos.js'
import { corsPorRuta, helmetNubio, panelConfigurado, origenesSeSolapan } from './middleware/seguridad.js'
import { configuracionTokenOperadorOk } from './utils/tokenOperador.js'
import { configuracionCifradoOk } from './utils/cifrado.js'
import { crearRutasAdmin } from './routes/admin.js'
import { handleVerActivacionCuenta, handleActivarCuenta } from './controllers/activarCuenta.js'
import { rutaNoEncontrada, manejarErrores } from './middleware/errores.js'
import { verificarConfiguracion } from './utils/token.js'
import { handleGetMarcas, handleCreateMarca, handleCreateMarcasBulk, handleUpdateMarca, handleDeleteMarca } from './controllers/marcas.js'
import { handleBuscarBoletinMarcas } from './controllers/boletines.js'
import { handleGetAlertas, handleResumenAlertas, handleUpdateAlerta } from './controllers/alertas.js'
import { handleCuotaCliente } from './controllers/cuota.js'

// Sin JWT_SECRET no se pueden firmar ni verificar tokens: cortamos al arrancar.
verificarConfiguracion()

// Panel comercial (etapa 2): se enciende solo si están sus tres variables
// (ADMIN_FRONTEND_URL, ADMIN_JWT_SECRET distinta de JWT_SECRET y
// ADMIN_CIFRADO_KEY). Si falta alguna, las rutas /admin no existen (404): el
// panel queda apagado, nunca a medias. Si está la URL pero falla un secreto,
// no arranca: es un error de configuración que hay que ver.
const conPanel = panelConfigurado()
if (conPanel && !(configuracionTokenOperadorOk() && configuracionCifradoOk())) {
    throw new Error('Panel comercial: ADMIN_FRONTEND_URL está definido, pero falta ADMIN_JWT_SECRET (distinta de JWT_SECRET) o ADMIN_CIFRADO_KEY.')
}
if (conPanel && origenesSeSolapan()) {
    throw new Error('Panel comercial: ADMIN_FRONTEND_URL no puede ser la misma dirección que FRONTEND_URL (el panel va en otro sitio).')
}
console.log(`Panel comercial: ${conPanel ? 'encendido' : 'apagado (sin ADMIN_FRONTEND_URL)'}`)

// Conexión a Postgres: config compartida con los scripts (ver db.js).
const db = crearDb()

// requireAuth necesita la base: además de la firma del token, revisa que su
// versión siga vigente (que no se haya cambiado la contraseña después).
const requireAuth = crearRequireAuth(db)

// Toda ruta con datos lleva `conSesion`: primero el token (requireAuth deja
// req.userId) y después el límite por usuario, que necesita ese id.
// Express acepta un array de middlewares donde va uno solo.
const conSesion = [requireAuth, limitadorUsuario]

// Registro cerrado salvo REGISTRO_ABIERTO=true (noviembre 2026). Hasta que haya
// roles, cualquiera con la URL podía crearse una cuenta; las cuentas del
// estudio ya existen. Cerrado por defecto: si falta la variable, queda cerrado.
const registroAbierto = process.env.REGISTRO_ABIERTO === 'true'

// Búsquedas de Boletines EN CURSO por usuario (M1 de la revisión de los
// límites). Cada una usa 3 de las 10 conexiones del pool: con 3 a la vez, un
// usuario ocupa como mucho 9 y nunca deja sin conexión al login. Alcanza para 3
// personas: el frontend cancela la búsqueda anterior antes de pedir otra.
const turnoBusqueda = crearLimiteSimultaneo({
    maximo: 3,
    mensaje: 'Hay otras búsquedas en curso. Esperá un momento y volvé a probar.',
})

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
// Rutas que distinguen mayúsculas: /ADMIN/... no es /admin/... (Case, M1 de la
// etapa 2). Las de la app son todas en minúscula: no cambia nada para ellas.
app.set('case sensitive routing', true)

// Orden: helmet primero (headers de seguridad en TODAS las respuestas, incluso
// errores y 429), después CORS (antes del limitador, para que el 429 lleve el
// header CORS y el frontend pueda leer el mensaje), después el limitador.
// corsPorRuta lee FRONTEND_URL (y corta el arranque si no está) y, con el
// panel encendido, ADMIN_FRONTEND_URL para las rutas /admin.
app.use(helmetNubio())
app.use(corsPorRuta({ conPanel }))

// Chequeo de salud: lo llaman Render (Health Check Path) y el monitor externo.
// Va ANTES del limitador: si cayera en un 429, Render creería que el servidor
// está caído. No toca la base, así que no hay nada que proteger.
app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'API funcionando' })
})

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

// --- Rutas públicas (no piden token) ---
// El limitador va antes del handler: si la IP se pasó, responde 429 y no se
// llega a correr bcrypt ni a tocar la base.
app.post('/signin', limitadorLogin, (req, res) => handleSignin(req, res, db, bcrypt));
app.post('/register', (req, res, next) => {
    if (registroAbierto) return next()
    res.status(403).json({ error: 'El registro de cuentas nuevas está cerrado.' })
}, limitadorRegistro, (req, res) => handleRegister(req, res, db, bcrypt));

// --- Rutas protegidas ---
// conSesion (requireAuth + limitadorUsuario) va como segundo argumento: Express
// lo corre antes del handler. Si el token falta o no es válido, responde 401 y
// el handler no se ejecuta. Toda ruta nueva que maneje datos tiene que llevarlo.

app.get('/me', conSesion, (req, res) => handleMe(req, res, db))
app.patch('/me', conSesion, (req, res) => handleUpdateMe(req, res, db))
// El limitador va después de conSesion: cuenta por sesión (req.sesionId).
app.post('/me/password', conSesion, limitadorCambioPassword, (req, res) => handleCambiarPassword(req, res, db, bcrypt))

// Marcas
app.get('/marcas', conSesion, (req, res) => handleGetMarcas(req, res, db))
// limitadorEscrituraMarcas: alta, edición y borrado de a una (cuenta solo lo
// que hace trabajar al motor o borra; ver middleware/rateLimit.js).
app.post('/marcas', conSesion, limitadorEscrituraMarcas, (req, res) => handleCreateMarca(req, res, db))
// limitadorImportacion va después de conSesion: cuenta por usuario (req.userId).
app.post('/marcas/bulk', conSesion, limitadorImportacion, (req, res) => handleCreateMarcasBulk(req, res, db))
// Editar manda la marca completa; PATCH y no PUT porque es lo que ya permite
// CORS (como /me y /alertas).
app.patch('/marcas/:id', conSesion, limitadorEscrituraMarcas, (req, res) => handleUpdateMarca(req, res, db))
app.delete('/marcas/:id', conSesion, limitadorEscrituraMarcas, (req, res) => handleDeleteMarca(req, res, db))

// Boletines DINAPI: los datos son públicos, pero la consulta es pesada.
// Se protege para que no la pueda martillar cualquiera.
// POST y no GET: la búsqueda va en el cuerpo, que no queda en los logs de acceso.
app.post('/boletines/marcas/buscar', conSesion, limitadorBoletinesSesion, limitadorBoletines, (req, res) =>
    turnoBusqueda(req, res, () => handleBuscarBoletinMarcas(req, res, db)))

// Alertas
app.get('/alertas', conSesion, (req, res) => handleGetAlertas(req, res, db))
// Contador del menú del frontend: { nuevas, urgentes }, sin traer las alertas.
app.get('/alertas/resumen', conSesion, (req, res) => handleResumenAlertas(req, res, db))
app.patch('/alertas/:id', conSesion, (req, res) => handleUpdateAlerta(req, res, db))

// Aviso de cuota (panel comercial, etapa 4): { estado, pagado_hasta, dias } de
// la cuenta del token. Existe aunque el panel esté apagado (sin pagos, dice
// 'sin_pagos'); necesita sql/017.
app.get('/cuenta/cuota', conSesion, (req, res) => handleCuotaCliente(req, res, db))

// --- Panel comercial (etapa 2): router aparte, ver routes/admin.js ---
if (conPanel) app.use('/admin', crearRutasAdmin(db, bcrypt))

// Activación de clientes (etapa 3): el link que genera el panel. Públicas y de
// la APP (CORS de FRONTEND_URL): el cliente crea su contraseña en Nubio. Solo
// con el panel encendido (el token se verifica con ADMIN_CIFRADO_KEY).
// Sin caché (Case, I3): devuelven el nombre y el correo del cliente.
const sinCache = (req, res, next) => { res.set('Cache-Control', 'no-store'); next() }
if (conPanel) {
    app.use('/activar-cuenta', sinCache)
    app.post('/activar-cuenta/ver', limitadorActivacionCuenta, (req, res) => handleVerActivacionCuenta(req, res, db))
    app.post('/activar-cuenta', limitadorActivacionCuenta, (req, res) => handleActivarCuenta(req, res, db, bcrypt))
}

// --- Al final, siempre: lo que no atendió ninguna ruta ---
app.use(rutaNoEncontrada)
app.use(manejarErrores)

const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
    console.log(`App is running on port ${PORT}`)
})