// Carga un CSV de boletín de DINAPI en la tabla boletin_marcas.
// Uso: npm run importar-boletin -- data/boletines/2026-10-19.csv
// Usa DATABASE_URL del .env; para producción, correrlo con la URL de Neon.
import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { crearDb } from '../db.js'
import { normalizarMarca, validarMarca } from '../utils/marcaValidation.js'
import { generarAlertasParaBoletin } from '../services/alertas.js'
import { parsearLineaCsv } from '../utils/csv.js'

const COLUMNAS_CSV = 11
// Los diarios traen el nombre; si llega la letra (M, D, F, T, S) se usa tal cual.
const SIGNO_POR_NOMBRE = { Mixta: 'M', Denominativa: 'D', Figurativa: 'F', Tridimensional: 'T', Sonora: 'S' }
// DINAPI usa UK para el Reino Unido; el código ISO (y el de Nubio) es GB
const PAIS_ISO = { UK: 'GB' }

// Denominación y Solicitante vienen URL-encoded ("CAF%C3%89" = "CAFÉ").
// Agente NO: si tiene coma viene entre comillas ("Ramirez Gonzalez, Sergio"),
// por eso se separa con parsearLineaCsv y no con split(',').
function decodificar(valor) {
    try {
        return decodeURIComponent(valor)
    } catch {
        return valor // un "%" suelto que no es un escape: lo dejamos tal cual
    }
}

const vacioANull = (v) => (v === '' ? null : v)

function parsearFila(linea) {
    const celdas = parsearLineaCsv(linea).map((c) => c.trim())
    if (celdas.length !== COLUMNAS_CSV) {
        return { error: `tiene ${celdas.length} columnas en vez de ${COLUMNAS_CSV}` }
    }
    const [fecha, expediente, clase, denominacion, signo, solicitante, pais, agente, matricula, tramite, referencia] = celdas

    // Reusamos la validación de marcas para los campos que comparten.
    // La fecha del boletín ocupa el lugar de fecha_solicitud solo para validarla.
    const marca = normalizarMarca({
        fecha_solicitud: fecha,
        expediente,
        clase_niza: clase,
        denominacion: decodificar(denominacion),
        signo: SIGNO_POR_NOMBRE[signo] ?? signo,
        titular: decodificar(solicitante),
        pais: PAIS_ISO[pais] ?? pais,
    })
    const errores = validarMarca(marca)
    if (Object.keys(errores).length > 0) {
        return { error: Object.values(errores).join(' ') }
    }
    if (!tramite) return { error: 'Falta el trámite.' }

    const { fecha_solicitud, ...resto } = marca
    return {
        fila: {
            ...resto,
            fecha_publicacion: fecha_solicitud,
            denominacion: vacioANull(resto.denominacion),
            agente: vacioANull(agente),
            matricula: vacioANull(matricula),
            tramite,
            referencia: vacioANull(referencia),
        },
    }
}

async function main() {
    const ruta = process.argv[2]
    if (!ruta) {
        console.error('Uso: npm run importar-boletin -- <archivo.csv>')
        process.exit(1)
    }

    // El archivo viene con BOM (un ﻿ invisible al principio): lo sacamos
    // para que no quede pegado al primer encabezado.
    const texto = (await readFile(ruta, 'utf8')).replace(/^﻿/, '')
    const lineas = texto.split(/\r?\n/).filter((l) => l.trim() !== '')
    const [, ...datos] = lineas // la primera línea es el encabezado

    const filas = []
    const errores = []
    datos.forEach((linea, i) => {
        const resultado = parsearFila(linea)
        // +2: una por el encabezado y otra porque las filas se cuentan desde 1
        if (resultado.error) errores.push(`Fila ${i + 2}: ${resultado.error}`)
        else filas.push(resultado.fila)
    })

    // Misma conexión que el servidor (TLS verificado, fechas como texto).
    const db = crearDb()

    try {
        const insertadas = filas.length === 0 ? [] : await db('boletin_marcas')
            .insert(filas)
            .onConflict(['fecha_publicacion', 'expediente'])
            .ignore()
            .returning('id')

        console.log(`Filas leídas:  ${datos.length}`)
        console.log(`Insertadas:    ${insertadas.length}`)
        console.log(`Ya existían:   ${filas.length - insertadas.length}`)
        console.log(`Con error:     ${errores.length}`)
        errores.forEach((e) => console.log(`  - ${e}`))

        // Cada boletín nuevo se compara contra las marcas de todos los usuarios.
        const fechas = [...new Set(filas.map((f) => f.fecha_publicacion))]
        for (const fecha of fechas) {
            const alertas = await generarAlertasParaBoletin(db, fecha)
            console.log(`Alertas nuevas (${fecha}): ${alertas}`)
        }
    } finally {
        // Sin esto el pool de conexiones queda abierto y el script no termina.
        await db.destroy()
    }
}

main().catch((err) => {
    console.error(err)
    process.exit(1)
})
