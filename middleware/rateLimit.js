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

// General: un techo amplio para toda la API, contra scripts que martillan
// cualquier ruta (por ejemplo /boletines/marcas, que es pesada).
// 500 cada 15 minutos son ~33 por minuto: un uso normal no se acerca, ni
// siquiera varias personas de un estudio que salen a internet con la misma IP.
export const limitadorGeneral = limitador({
    windowMs: QUINCE_MINUTOS,
    limit: 500,
    message: { error: 'Demasiados pedidos. Esperá unos minutos y volvé a probar.' },
})
