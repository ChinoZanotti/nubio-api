import cors from 'cors'
import helmet from 'helmet'

// --- CORS ---
// El navegador no deja que una página lea respuestas de OTRO sitio salvo que
// ese sitio lo autorice con el header Access-Control-Allow-Origin. Con
// cors() a secas respondíamos "*": cualquier página podía usar la API desde el
// navegador de un usuario. Ahora solo el frontend de Nubio.
//
// Ojo con lo que CORS NO hace: no frena a curl, Postman ni scripts. Eso lo
// hacen requireAuth y el rate limit. CORS protege al USUARIO dentro de su
// navegador, frente a páginas de terceros.
//
// FRONTEND_URL: uno o varios orígenes separados por coma, sin barra final.
// Un origen es protocolo + dominio + puerto: "https://nubio.onrender.com".
// En local: "http://localhost:5173" (el puerto de Vite).
function origenesPermitidos() {
    const lista = (process.env.FRONTEND_URL ?? '')
        .split(',')
        .map((o) => o.trim().replace(/\/$/, ''))
        .filter(Boolean)
    if (lista.length === 0) {
        throw new Error('FRONTEND_URL no está definido (ej: https://nubio.onrender.com).')
    }
    return lista
}

// Se llama al arrancar: sin FRONTEND_URL el servidor no levanta, así nunca
// queda abierto a todos por olvidarse la variable.
export function corsNubio() {
    return cors({
        origin: origenesPermitidos(),
        // Solo lo que usa el frontend. Authorization lleva el token JWT.
        methods: ['GET', 'POST', 'PATCH'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        // El frontend manda el token en un header, no en cookies: no hace falta
        // credentials. (Si algún día se pasa a cookie, habilitarlo acá.)
        credentials: false,
        // Antes de cada POST/PATCH con JSON, el navegador pregunta primero si
        // puede (un pedido OPTIONS, el "preflight"). Con esto recuerda la
        // respuesta 10 minutos en vez de preguntar cada vez.
        maxAge: 600,
    })
}

// --- Helmet ---
// Agrega headers de seguridad a todas las respuestas. Los que importan para
// una API que solo devuelve JSON:
// - X-Content-Type-Options: nosniff -> el navegador no "adivina" el tipo de
//   archivo: un JSON no se puede ejecutar como script.
// - Strict-Transport-Security -> el navegador recuerda usar siempre HTTPS.
// - Content-Security-Policy restrictiva -> si alguien abriera una respuesta de
//   la API como página, no puede ejecutar nada.
// - X-Frame-Options / frame-ancestors -> nadie puede meter la API en un iframe.
// - Saca X-Powered-By: Express (no le contamos al atacante qué usamos).
// Los headers de la PÁGINA (el frontend) se configuran aparte, en Render.
//
// La CSP por defecto de helmet está pensada para páginas web (permite scripts y
// estilos del mismo sitio). La API nunca sirve HTML, así que va la más estricta:
// no cargar nada y no dejarse embeber en ningún iframe.
export function helmetNubio() {
    return helmet({
        contentSecurityPolicy: {
            useDefaults: false,
            directives: {
                defaultSrc: ["'none'"],
                frameAncestors: ["'none'"],
            },
        },
        frameguard: { action: 'deny' },
    })
}
