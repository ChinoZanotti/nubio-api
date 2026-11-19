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

    // 1) Lo que ve NODE, en NUESTRO tramo (app -> servidor al que nos
    // conectamos). Es lo que decide si la conexión es segura:
    // - encrypted: el socket es TLS (cifrado);
    // - authorized: Node validó la cadena del certificado Y que corresponda al
    //   host. Si fuera false, iría cifrada pero podría ser con un impostor.
    // getProtocol() da la versión de TLS (TLSv1.3...).
    const conexion = await db.client.acquireConnection()
    const socket = conexion.connection?.stream
    const cifrado = socket?.encrypted === true
    const verificado = cifrado && socket.authorized === true
    const protocolo = cifrado ? socket.getProtocol?.() : null
    await db.client.releaseConnection(conexion)
    console.log(`Cifrado: ${cifrado ? `sí (${protocolo})` : 'no'}`)
    console.log(`Certificado verificado: ${verificado ? 'sí' : 'no'}`)

    // 2) Lo que ve POSTGRES (pg_stat_ssl), solo informativo. OJO: con el
    // pooler de Neon (host "-pooler", PgBouncer) Postgres ve la conexión que
    // tiene CON EL POOLER, dentro de la red de Neon, no la nuestra. Por eso
    // puede decir "sin TLS" aunque nuestro tramo vaya cifrado y verificado.
    const ssl = (await db.raw('select ssl, version from pg_stat_ssl where pid = pg_backend_pid()')).rows[0]
    const viaPooler = host.includes('-pooler')
    console.log(`(Postgres ve su conexión ${viaPooler ? 'con el pooler' : 'con nosotros'}: ${ssl?.ssl ? `TLS ${ssl.version}` : 'sin TLS'})`)

    // 3) La intercalación ICU del español: la usa GET /boletines/marcas para
    // ordenar texto. Si falta, ese endpoint respondería 500.
    const icu = (await db.raw(`select 1 from pg_collation where collname = 'es-x-icu'`)).rows.length > 0
    console.log(`Intercalación es-x-icu: ${icu ? 'sí' : 'NO (falta: /boletines/marcas va a fallar al ordenar)'}`)
    if (!icu) process.exitCode = 1

    if (esNeon && !verificado) {
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
