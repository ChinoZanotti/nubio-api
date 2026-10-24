// Vuelve a correr el motor de similitud sobre todos los boletines cargados.
// Sirve después de ajustar el motor (umbral, términos genéricos, clases) o si
// falló la generación al cargar una marca. Solo agrega alertas nuevas: las que
// ya existen quedan como están, con su estado y nota.
// Uso: npm run recalcular-alertas
import 'dotenv/config'
import knex from 'knex'
import pg from 'pg'
import { generarAlertasParaBoletin } from '../services/alertas.js'

// Igual que en server.js: las fechas como "aaaa-mm-dd" y no como Date de JS.
pg.types.setTypeParser(1082, (valor) => valor)

async function main() {
    const db = knex({
        client: 'pg',
        connection: {
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.DATABASE_URL?.includes('neon.tech')
                ? { rejectUnauthorized: false }
                : false,
        },
    })

    try {
        const fechas = await db('boletin_marcas').distinct('fecha_publicacion').orderBy('fecha_publicacion')
        let total = 0
        for (const { fecha_publicacion } of fechas) {
            const nuevas = await generarAlertasParaBoletin(db, fecha_publicacion)
            console.log(`${fecha_publicacion}: ${nuevas} alertas nuevas`)
            total += nuevas
        }
        console.log(`Total: ${total}`)
    } finally {
        await db.destroy()
    }
}

main().catch((err) => {
    console.error(err)
    process.exit(1)
})
