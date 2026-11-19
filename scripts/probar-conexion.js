// Prueba la conexión a la base con la misma configuración que el servidor
// (incluida la verificación del certificado TLS de Neon).
// Uso: npm run probar-conexion
// Para probar contra Neon sin tocar el .env, en bash:
//   DATABASE_URL="postgresql://...neon.tech/..." npm run probar-conexion
import 'dotenv/config'
import { crearDb } from '../db.js'

const db = crearDb()
try {
    const { rows } = await db.raw('select current_database() as base, version() as version')
    const host = new URL(process.env.DATABASE_URL).hostname
    console.log(`Conexión OK a "${rows[0].base}" en ${host}`)
    console.log(rows[0].version)
    console.log(host.includes('neon.tech') ? 'TLS: certificado verificado.' : 'TLS: no se usa (base local).')
} catch (err) {
    console.error('No se pudo conectar:', err.message)
    process.exitCode = 1
} finally {
    await db.destroy()
}
