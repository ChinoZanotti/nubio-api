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
export function crearDb() {
    const url = process.env.DATABASE_URL
    if (!url) {
        throw new Error('DATABASE_URL no está definido.')
    }
    return knex({
        client: 'pg',
        connection: {
            connectionString: url,
            ssl: url.includes('neon.tech') ? { rejectUnauthorized: true } : false,
        },
    })
}
