import { rateLimit } from 'express-rate-limit'
import { registrarEvento } from '../utils/eventos.js'

// Rate limiting: cuenta cuántos pedidos hace cada IP en una ventana de tiempo y,
// si se pasa, responde 429 (Too Many Requests) sin llegar al controlador.
//
// Los contadores viven en memoria: se reinician si el servidor se reinicia y no
// se comparten entre instancias. Alcanza mientras haya una sola instancia en Render.
//
// standardHeaders: manda el header RateLimit con cuántos pedidos quedan y cuándo
// se reinicia la ventana. legacyHeaders: false apaga los viejos X-RateLimit-*.

const QUINCE_MINUTOS = 15 * 60 * 1000
const UNA_HORA = 60 * 60 * 1000

// Cada 429 queda en el registro de eventos de seguridad (utils/eventos.js).
// Pero un atacante frenado manda cientos de pedidos por minuto: registrar cada
// uno llenaría el log y taparía lo importante. Se registra el primero de cada
// limitador + IP/usuario y después a lo sumo uno por minuto, con cuántos se
// frenaron en el medio (`frenados`).
const INTERVALO_REGISTRO_MS = 60 * 1000
const MAX_CLAVES_REGISTRO = 10_000
const ultimosRegistros = new Map() // `${nombre}|${clave}` -> { desde, frenados }

function registrarLimite(nombre, req) {
    // Por usuario (si el limitador cuenta por usuario) o por IP
    const quien = req.userId !== undefined ? { usuario: req.userId } : {}
    const k = `${nombre}|${req.userId ?? req.ip}`
    const ahora = Date.now()
    const previo = ultimosRegistros.get(k)
    if (previo && ahora - previo.desde < INTERVALO_REGISTRO_MS) {
        previo.frenados += 1
        return
    }
    registrarEvento('limite_superado', { limitador: nombre, ip: req.ip, ...quien, frenados: (previo?.frenados ?? 0) + 1 })
    // Tope de memoria: si se llena (muchas IPs distintas), se empieza de cero.
    if (ultimosRegistros.size >= MAX_CLAVES_REGISTRO) ultimosRegistros.clear()
    ultimosRegistros.set(k, { desde: ahora, frenados: 0 })
}

// `nombre` identifica al limitador en el registro de eventos.
function limitador(nombre, opciones) {
    return rateLimit({
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        ...opciones,
        // Lo mismo que hace express-rate-limit por defecto (responder 429 con
        // el mensaje), más el registro del evento.
        handler(req, res, next, opcionesFinales) {
            registrarLimite(nombre, req)
            res.status(opcionesFinales.statusCode).send(opcionesFinales.message)
        },
    })
}

// Login: frena a quien prueba contraseñas una tras otra (fuerza bruta).
// skipSuccessfulRequests: solo cuentan los intentos FALLIDOS (respuesta >= 400).
// Quien entra bien no gasta intentos; quien se equivoca 10 veces espera 15 minutos.
export const limitadorLogin = limitador('login', {
    windowMs: QUINCE_MINUTOS,
    limit: 10,
    skipSuccessfulRequests: true,
    message: { error: 'Demasiados intentos fallidos. Esperá 15 minutos y volvé a probar.' },
})

// Registro: frena la creación masiva de cuentas. Cada registro corre bcrypt
// (caro en CPU) y crea filas en la base. Cuentan todos los intentos.
export const limitadorRegistro = limitador('registro', {
    windowMs: UNA_HORA,
    limit: 5,
    message: { error: 'Demasiados registros desde esta conexión. Probá de nuevo en una hora.' },
})

// Cambio de contraseña: quien tenga un token robado podría usar esta ruta para
// adivinar la contraseña actual (cada intento la compara con bcrypt). 5 fallos
// cada 15 minutos alcanzan para equivocarse al tipear y frenan la fuerza bruta.
//
// Por SESIÓN (req.sesionId), no por usuario (revisión de Case de Mi cuenta,
// hallazgo medio): con la clave por usuario, el atacante gastaba los 5
// intentos con su token y la víctima recibía 429 justo cuando quería cambiar
// la contraseña por sospechar un robo. Ahora cada sesión tiene su contador.
// No se suma un tope por usuario "de respaldo": volvería a dejar que el
// atacante bloquee a la víctima.
//
// Solo cuenta cuando la contraseña ACTUAL estuvo mal (el controlador lo marca
// en res.locals.actualIncorrecta). Una nueva rechazada por la política o por
// filtrada no revela nada de la actual y no tiene que bloquear a quien la
// sabe. Igual que skipSuccessfulRequests a secas, el intento se suma ANTES del
// controlador y se resta al terminar: los pedidos en paralelo no se cuelan.
// Tiene que ir DESPUÉS de requireAuth en la ruta: usa req.userId y req.sesionId.
export const limitadorCambioPassword = limitador('cambio_password', {
    windowMs: QUINCE_MINUTOS,
    limit: 5,
    skipSuccessfulRequests: true,
    requestWasSuccessful: (req, res) => !res.locals.actualIncorrecta,
    keyGenerator: (req) => `sesion:${req.userId}:${req.sesionId}`,
    message: { error: 'Demasiados intentos fallidos. Esperá 15 minutos y volvé a probar.' },
})

// Importaciones: por USUARIO, no por IP. Cada importación encola hasta 1000
// marcas para el motor; con el límite por IP, alguien con varias cuentas o
// varias IPs podía mandar cientos por hora. 10 por hora alcanza para un uso
// real (cargar la cartera en varios archivos) y frena el abuso.
// Tiene que ir DESPUÉS de requireAuth en la ruta: usa req.userId.
export const limitadorImportacion = limitador('importacion', {
    windowMs: UNA_HORA,
    limit: 10,
    keyGenerator: (req) => `usuario:${req.userId}`,
    message: { error: 'Hiciste muchas importaciones en poco tiempo. Probá de nuevo en una hora.' },
})

// Escrituras de una en una sobre marcas (alta, edición, borrado), por USUARIO
// (revisión de Case de editar/borrar marcas, M1). Antes el trabajo del motor
// tenía un techo de hecho: 5000 marcas por cuenta en toda su vida. Con borrar,
// crear-borrar-crear no tiene fin, y editar la denominación en bucle encola
// una regeneración por pedido. Solo el límite general (1500 cada 15 min) lo
// frenaba: minutos de CPU que demoran las alertas de todos.
//
// Solo cuenta lo que hace trabajar al motor o destruye datos: el controlador
// lo marca en res.locals.escrituraPesada (encoló alertas o borró). Editar el
// titular no cuenta. 200 cada 15 minutos alcanza para que 3 personas corrijan
// marcas a mano a buen ritmo, y frena un script. Igual que
// limitadorCambioPassword, se suma antes y se resta al terminar si no contó.
// Tiene que ir DESPUÉS de requireAuth en la ruta: usa req.userId.
export const limitadorEscrituraMarcas = limitador('escritura_marcas', {
    windowMs: QUINCE_MINUTOS,
    limit: 200,
    skipSuccessfulRequests: true,
    requestWasSuccessful: (req, res) => !res.locals.escrituraPesada,
    keyGenerator: (req) => `usuario:${req.userId}`,
    message: { error: 'Hiciste muchos cambios seguidos en tus marcas. Esperá unos minutos y volvé a probar.' },
})

// Boletines: por USUARIO (tercera revisión de Case, B2). Cada pedido corre
// varias consultas sobre 13.000+ filas; el límite general por IP deja pasar 500
// de golpe y, con el pool de 10 conexiones, eso hacía esperar a todos (incluido
// el login). 60 por minuto sobran para UNA persona: el filtro espera 300 ms
// después de la última tecla y una página se pide de a una.
//
// Hoy un mismo usuario lo usan 3 personas del estudio (noviembre 2026), así que
// van dos límites (revisión de Case de los límites, M1):
// - por SESIÓN, 60: cada persona tiene su propio cupo y ninguna le gasta el
//   suyo a las otras;
// - por USUARIO, 180: el techo de la cuenta. Por sesión solo no alcanza: quien
//   tiene la contraseña abre sesiones nuevas cuando quiere.
// Además, server.js limita las búsquedas EN CURSO (middleware/simultaneos.js):
// estos límites cuentan por minuto y no frenan una ráfaga.
// Cuando cada persona tenga su cuenta, el de usuario puede volver a 60.
// Tienen que ir DESPUÉS de requireAuth en la ruta: usan req.userId y req.sesionId.
export const limitadorBoletinesSesion = limitador('boletines_sesion', {
    windowMs: 60 * 1000,
    limit: 60,
    keyGenerator: (req) => `sesion:${req.userId}:${req.sesionId}`,
    message: { error: 'Demasiadas búsquedas seguidas. Esperá un minuto y volvé a probar.' },
})

export const limitadorBoletines = limitador('boletines', {
    windowMs: 60 * 1000,
    limit: 180,
    keyGenerator: (req) => `usuario:${req.userId}`,
    message: { error: 'Demasiadas búsquedas seguidas. Esperá un minuto y volvé a probar.' },
})

// General por IP: techo contra quien martilla la API SIN sesión válida (login,
// registro, tokens inventados o vencidos, rutas que no existen).
//
// Los pedidos con sesión válida (requireAuth dejó req.userId) se descuentan al
// terminar, así que no gastan el cupo de la IP: de esos se ocupa
// limitadorUsuario. Antes contaban todos, y las personas de un estudio, que
// salen a internet con la MISMA IP, compartían 500 pedidos cada 15 minutos; con
// uso intensivo de Boletines podían recibir 429. Igual que en
// limitadorCambioPassword, el pedido se suma ANTES y se resta al terminar: si
// la IP ya pasó el tope, se frena aunque traiga sesión.
//
// GET / no pasa por acá (va antes en server.js): es el chequeo de salud de
// Render y del monitor, y no toca la base.
export const limitadorGeneral = limitador('general', {
    windowMs: QUINCE_MINUTOS,
    limit: 500,
    skipSuccessfulRequests: true,
    requestWasSuccessful: (req) => req.userId !== undefined,
    message: { error: 'Demasiados pedidos. Esperá unos minutos y volvé a probar.' },
})

// Por USUARIO, para todo pedido con sesión (server.js lo pone junto a
// requireAuth, en `conSesion`). Es el techo de quien tiene sesión: varias
// personas detrás de la misma IP no se frenan entre sí, y un script con un
// token robado igual tiene un límite. 1500 cada 15 minutos (~100 por minuto)
// alcanzan para 3 personas usando la misma cuenta: 500 cada una, lo que antes
// tenía una IP entera.
// Tiene que ir DESPUÉS de requireAuth: usa req.userId.
export const limitadorUsuario = limitador('usuario', {
    windowMs: QUINCE_MINUTOS,
    limit: 1500,
    keyGenerator: (req) => `usuario:${req.userId}`,
    message: { error: 'Demasiados pedidos. Esperá unos minutos y volvé a probar.' },
})
