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
function listaDeOrigenes(variable) {
    return (process.env[variable] ?? '')
        .split(',')
        .map((o) => o.trim().replace(/\/$/, ''))
        .filter(Boolean)
}

function origenesPermitidos() {
    const lista = listaDeOrigenes('FRONTEND_URL')
    if (lista.length === 0) {
        throw new Error('FRONTEND_URL no está definido (ej: https://nubio.onrender.com).')
    }
    return lista
}

// Se llama al arrancar: sin FRONTEND_URL el servidor no levanta, así nunca
// queda abierto a todos por olvidarse la variable.
function opcionesCors(origin) {
    return {
        origin,
        // Solo lo que usa el frontend. Authorization lleva el token JWT.
        // DELETE: borrar una marca (Mis marcas).
        methods: ['GET', 'POST', 'PATCH', 'DELETE'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        // El frontend manda el token en un header, no en cookies: no hace falta
        // credentials. (Si algún día se pasa a cookie, habilitarlo acá.)
        credentials: false,
        // Antes de cada POST/PATCH con JSON (y de cada DELETE), el navegador pregunta primero si
        // puede (un pedido OPTIONS, el "preflight"). Con esto recuerda la
        // respuesta 10 minutos en vez de preguntar cada vez.
        maxAge: 600,
    }
}

export function corsNubio() {
    return cors(opcionesCors(origenesPermitidos()))
}

// --- Panel comercial (etapa 2) ---
// El panel vive en otro sitio (otro origen) y sus rutas van bajo /admin. CORS
// separado (revisión de Case, M6): /admin solo acepta el origen del panel
// (ADMIN_FRONTEND_URL) y el resto de la API solo el de la app. Así, la app de
// clientes no puede llamar al panel desde el navegador, ni el panel a la app.
// Si falta la configuración del panel, las rutas /admin no se montan (server.js):
// el panel queda apagado, no abierto.
// Sin distinguir mayúsculas (revisión de Case de la etapa 2, M1): Express, por
// defecto, manda /ADMIN/... al router del panel; si este chequeo las distinguiera,
// esos pedidos llevarían el CORS de la app. Además server.js activa
// 'case sensitive routing' (y el router del panel, caseSensitive), así /ADMIN/... ni
// siquiera llega al panel: da 404.
export const esRutaAdmin = (req) => /^\/admin(\/|$)/i.test(req.path)

export function corsPorRuta({ conPanel }) {
    const app = corsNubio()
    const panel = conPanel ? cors(opcionesCors(listaDeOrigenes('ADMIN_FRONTEND_URL'))) : null
    return (req, res, next) => {
        if (esRutaAdmin(req)) return panel ? panel(req, res, next) : next()
        return app(req, res, next)
    }
}

export const panelConfigurado = () => listaDeOrigenes('ADMIN_FRONTEND_URL').length > 0

// El panel y la app tienen que estar en orígenes distintos: si coincidieran,
// se perdería la separación sin que nadie lo note (Case, informativo de la etapa 2).
export function origenesSeSolapan() {
    const app = new Set(listaDeOrigenes('FRONTEND_URL').map((o) => o.toLowerCase()))
    return listaDeOrigenes('ADMIN_FRONTEND_URL').some((o) => app.has(o.toLowerCase()))
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
