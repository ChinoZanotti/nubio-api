import { rateLimit } from 'express-rate-limit'

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

function limitador(opciones) {
    return rateLimit({
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        ...opciones,
    })
}

// Login: frena a quien prueba contraseñas una tras otra (fuerza bruta).
// skipSuccessfulRequests: solo cuentan los intentos FALLIDOS (respuesta >= 400).
// Quien entra bien no gasta intentos; quien se equivoca 10 veces espera 15 minutos.
export const limitadorLogin = limitador({
    windowMs: QUINCE_MINUTOS,
    limit: 10,
    skipSuccessfulRequests: true,
    message: { error: 'Demasiados intentos fallidos. Esperá 15 minutos y volvé a probar.' },
})

// Registro: frena la creación masiva de cuentas. Cada registro corre bcrypt
// (caro en CPU) y crea filas en la base. Cuentan todos los intentos.
export const limitadorRegistro = limitador({
    windowMs: UNA_HORA,
    limit: 5,
    message: { error: 'Demasiados registros desde esta conexión. Probá de nuevo en una hora.' },
})

// Importaciones: por USUARIO, no por IP. Cada importación encola hasta 1000
// marcas para el motor; con el límite por IP, alguien con varias cuentas o
// varias IPs podía mandar cientos por hora. 10 por hora alcanza para un uso
// real (cargar la cartera en varios archivos) y frena el abuso.
// Tiene que ir DESPUÉS de requireAuth en la ruta: usa req.userId.
export const limitadorImportacion = limitador({
    windowMs: UNA_HORA,
    limit: 10,
    keyGenerator: (req) => `usuario:${req.userId}`,
    message: { error: 'Hiciste muchas importaciones en poco tiempo. Probá de nuevo en una hora.' },
})

// Boletines: por USUARIO (tercera revisión de Case, B2). Cada pedido corre
// varias consultas sobre 13.000+ filas; el límite general por IP deja pasar 500
// de golpe y, con el pool de 10 conexiones, eso hacía esperar a todos (incluido
// el login). 60 por minuto sobra para un uso real: el filtro espera 300 ms
// después de la última tecla y una página se pide de a una.
// Tiene que ir DESPUÉS de requireAuth en la ruta: usa req.userId.
export const limitadorBoletines = limitador({
    windowMs: 60 * 1000,
    limit: 60,
    keyGenerator: (req) => `usuario:${req.userId}`,
    message: { error: 'Demasiadas búsquedas seguidas. Esperá un minuto y volvé a probar.' },
})

// General: un techo amplio para toda la API, contra scripts que martillan
// cualquier ruta (por ejemplo /boletines/marcas, que es pesada).
// 500 cada 15 minutos son ~33 por minuto: un uso normal no se acerca, ni
// siquiera varias personas de un estudio que salen a internet con la misma IP.
export const limitadorGeneral = limitador({
    windowMs: QUINCE_MINUTOS,
    limit: 500,
    message: { error: 'Demasiados pedidos. Esperá unos minutos y volvé a probar.' },
})
