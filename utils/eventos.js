import { createHmac } from 'node:crypto'

// Registro de eventos de seguridad (tercera revisión de Case: "no se registran
// logins fallidos, bloqueos ni registros"). Sin esto, un ataque contra el login
// no dejaba rastro y no había forma de enterarse ni de reconstruir qué pasó.
//
// Formato: una línea por evento, con la marca fija [seguridad] y JSON:
//   [seguridad] {"evento":"login_fallido","cuenta":"k3J9...","ip":"181.91.85.89","ts":"..."}
// En los logs de Render, buscar "[seguridad]" muestra solo estos eventos.
//
// Qué NO va nunca: contraseñas, tokens ni el email en claro. El email va como
// `cuenta`: un HMAC-SHA256 (hash con clave secreta), siempre igual para el
// mismo email. Sirve para ver "10 fallos contra la misma cuenta" sin decir
// cuál. Con clave, y no un SHA-256 común, porque un hash común se revierte
// probando los emails del estudio, que son fáciles de adivinar.
// La IP sí va tal cual: es lo que permite ver de dónde viene un ataque.

const MARCA = '[seguridad]'

// La clave se deriva de JWT_SECRET con un rótulo propio ("eventos"): es otra
// clave distinta de la que firma los tokens, sin agregar otra variable de
// entorno. Si JWT_SECRET cambia, cambian los códigos de cuenta (los eventos
// viejos y los nuevos ya no se pueden cruzar), y está bien así.
let clave = null
function claveEventos() {
    clave ??= createHmac('sha256', process.env.JWT_SECRET ?? '').update('eventos').digest()
    return clave
}

// Código de cuenta: 16 caracteres alcanzan para distinguir cuentas.
export function codigoDeCuenta(email) {
    return createHmac('sha256', claveEventos()).update(String(email)).digest('base64url').slice(0, 16)
}

// Durante `npm test` no se escribe (el corredor de tests de Node define
// NODE_TEST_CONTEXT): si no, la salida de los tests se llenaría de eventos.
// Los tests del propio registro pasan su función `escribir`.
const enTests = () => Boolean(process.env.NODE_TEST_CONTEXT)

// `datos` puede traer `email` (se convierte en `cuenta` y no se escribe) y
// cualquier otro dato SIN información personal (ip, motivo, limitador...).
export function registrarEvento(evento, { email, ...datos } = {}, escribir = null) {
    const linea = {
        evento,
        ...(email !== undefined && { cuenta: codigoDeCuenta(email) }),
        ...datos,
        ts: new Date().toISOString(),
    }
    const texto = `${MARCA} ${JSON.stringify(linea)}`
    if (escribir) return escribir(texto)
    if (!enTests()) console.log(texto)
}
