// Prueba la conexión a la base con la misma configuración que el servidor
// (db.js) y COMPRUEBA, en vez de suponer, que vaya cifrada y verificada.
// Uso: npm run probar-conexion
// Para probar contra Neon sin tocar el .env, en Git Bash:
//   DATABASE_URL="postgresql://...neon.tech/..." npm run probar-conexion
import 'dotenv/config'
import { crearDb } from '../db.js'

let db
try {
    db = crearDb()
} catch (err) {
    // Por ejemplo, sslmode=no-verify en una URL de Neon (ver db.js).
    console.error('Configuración rechazada:', err.message)
    process.exit(1)
}

const host = new URL(process.env.DATABASE_URL).hostname
const esNeon = host.includes('neon.tech')

try {
    const { rows } = await db.raw('select current_database() as base, version() as version')
    console.log(`Conexión OK a "${rows[0].base}" en ${host}`)
    console.log(rows[0].version)

    // 1) Lo que ve Postgres: ¿esta conexión va cifrada? ¿con qué versión de TLS?
    const ssl = (await db.raw('select ssl, version, cipher from pg_stat_ssl where pid = pg_backend_pid()')).rows[0]
    console.log(ssl?.ssl ? `Cifrado: sí (${ssl.version}, ${ssl.cipher})` : 'Cifrado: no')

    // 2) Lo que ve Node: ¿el certificado del servidor quedó verificado?
    // `authorized` es true solo si Node validó la cadena del certificado Y que
    // corresponda al host. Si fuera false, la conexión estaría cifrada pero
    // podría ser con un impostor.
    const conexion = await db.client.acquireConnection()
    const socket = conexion.connection?.stream
    const verificado = socket?.encrypted === true && socket.authorized === true
    await db.client.releaseConnection(conexion)
    console.log(`Certificado verificado: ${verificado ? 'sí' : 'no'}`)

    if (esNeon && !(ssl?.ssl && verificado)) {
        console.error('PROBLEMA: la conexión a Neon tiene que ir cifrada y con el certificado verificado.')
        process.exitCode = 1
    } else if (!esNeon) {
        console.log('(Base local: sin TLS es lo esperado.)')
    }
} catch (err) {
    console.error('No se pudo conectar:', err.message)
    process.exitCode = 1
} finally {
    await db.destroy()
}
