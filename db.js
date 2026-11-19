import knex from 'knex'
import pg from 'pg'

// Postgres DATE (OID 1082) -> string "aaaa-mm-dd" tal cual, sin convertir a
// Date de JS. Así no se corre un día por la zona horaria del servidor.
pg.types.setTypeParser(1082, (valor) => valor)

// Una sola configuración de la conexión para el servidor y los scripts.
// Antes estaba copiada en tres lugares; un cambio de seguridad en una copia
// y no en otra es justo el tipo de error que no se ve.
//
// TLS hacia Neon: la conexión va cifrada Y verificada.
// rejectUnauthorized: true -> Node comprueba que el certificado del servidor
// sea válido y que corresponda al host de DATABASE_URL. Antes estaba en false:
// la conexión iba cifrada, pero sin comprobar CON QUIÉN. Alguien en el medio
// de la red (por ejemplo, en un wifi público mientras corrés un script contra
// producción) podía hacerse pasar por Neon y leer la contraseña y los datos.
// Neon usa certificados de una autoridad pública, que Node ya reconoce.
//
// OJO: lo que diga la URL MANDA. `pg` hace Object.assign(config, parse(url)):
// si DATABASE_URL trae `sslmode`, eso REEMPLAZA el `ssl` que ponemos acá.
//   sslmode=no-verify -> cifra pero NO verifica, en silencio.
//   sslmode=disable   -> ni siquiera cifra.
//   sslmode=require (el que trae la URL de Neon) -> hoy `pg` lo trata como
//     verify-full, pero avisa que desde pg 9 va a significar "cifrar SIN
//     verificar" (como libpq). Al actualizar `pg` perderíamos la verificación
//     sin enterarnos.
// Por eso, con Neon: no-verify y disable cortan el arranque (alguien pidió
// algo inseguro a propósito), y cualquier otro sslmode se SACA de la URL, para
// que siempre mande nuestro { rejectUnauthorized: true }, en cualquier versión.
const SSLMODE_INSEGUROS = ['no-verify', 'disable']

function prepararUrl(url) {
    let parseada
    try {
        parseada = new URL(url)
    } catch {
        throw new Error('DATABASE_URL no es una URL válida.')
    }
    if (!parseada.hostname.endsWith('neon.tech')) return { url, esNeon: false }

    const sslmode = parseada.searchParams.get('sslmode')
    if (SSLMODE_INSEGUROS.includes(sslmode)) {
        throw new Error(
            `DATABASE_URL tiene sslmode=${sslmode}: la conexión a Neon no se verificaría. ` +
            'Sacá ese parámetro de la URL (db.js ya exige cifrado verificado).',
        )
    }
    parseada.searchParams.delete('sslmode')
    return { url: parseada.toString(), esNeon: true }
}

export function crearDb() {
    if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL no está definido.')
    }
    const { url, esNeon } = prepararUrl(process.env.DATABASE_URL)
    return knex({
        client: 'pg',
        connection: {
            connectionString: url,
            ssl: esNeon ? { rejectUnauthorized: true } : false,
        },
    })
}
