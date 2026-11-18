// Convierte un reporte semanal de DINAPI ("Boletines Marcas Recibidas") en un
// CSV diario por fecha, con el mismo formato que los boletines diarios que
// lee importar-boletin.js.
//
// Uso: npm run convertir-boletin-semanal -- <reporte.csv> [carpeta-salida]
// Por defecto escribe en data/boletines/aaaa-mm-dd.csv. Si el archivo de una
// fecha ya existe, NO lo pisa: avisa y sigue con la próxima.
//
// Diferencias que resuelve (semanal → diario):
// - 5 líneas de encabezado (título, rango, aviso legal) → se descartan
// - Fecha "19/10/2026"          → "2026-10-19"
// - Texto plano                  → Denominación y Solicitante URL-encoded
// - Signo "M"                    → "Mixta"
// - Matrícula "5.524"            → "5524"
// - Trámite "Registro de Marca"  → "Registro de Marcas" (como en el diario;
//   si no, el filtro de Trámite mostraría las dos variantes)
//
// OJO: el reporte semanal pasa por Excel, que puede dañar valores (números
// convertidos en fecha, ceros a la izquierda borrados). Si DINAPI ofrece el
// boletín diario de una fecha, usar ese y no convertir el semanal.
import { readFile, writeFile, access } from 'node:fs/promises'
import path from 'node:path'
import { parsearLineaCsv, celdaCsv } from '../utils/csv.js'

const ENCABEZADO = 'Fecha,Expediente,Clase,Denominacion,Signo,Solicitante,Pais,Agente,Matricula,Tramite,Referencia'
const NOMBRE_POR_SIGNO = { M: 'Mixta', D: 'Denominativa', F: 'Figurativa', T: 'Tridimensional', S: 'Sonora' }
const BOM = '﻿'

// Las filas de datos son las únicas que empiezan con una fecha dd/mm/aaaa
const ES_FILA_DE_DATOS = /^\d{2}\/\d{2}\/\d{4},/

function aFechaIso(texto) {
    const [dia, mes, anio] = texto.split('/')
    return `${anio}-${mes}-${dia}`
}

// Excel guarda una fecha como el número de días desde el 30/12/1899. Si
// convirtió un número en fecha, esta cuenta lo recupera. Verificado contra
// DINAPI: 10/02/1900 → 42, 17/08/1901 → 595, 19/09/3131 → 449876.
function serialDeExcel(texto) {
    const [dia, mes, anio] = texto.split('/').map(Number)
    return Math.round((Date.UTC(anio, mes - 1, dia) - Date.UTC(1899, 11, 30)) / 86_400_000)
}

function convertirFila(celdas) {
    const [fecha, expediente, clase, denominacion, signo, titular, pais, agente, matricula, tramite, referencia] =
        celdas.map((c) => c.trim())

    return {
        fecha: aFechaIso(fecha),
        celdas: [
            aFechaIso(fecha),
            expediente,
            clase,
            encodeURIComponent(denominacion),
            NOMBRE_POR_SIGNO[signo] ?? signo,
            encodeURIComponent(titular),
            pais,
            agente,
            matricula.replaceAll('.', ''),
            tramite.replace(/ de Marca$/, ' de Marcas'),
            referencia,
        ],
    }
}

async function existe(ruta) {
    try {
        await access(ruta)
        return true
    } catch {
        return false
    }
}

async function main() {
    const [entrada, salida = 'data/boletines'] = process.argv.slice(2)
    if (!entrada) {
        console.error('Uso: npm run convertir-boletin-semanal -- <reporte.csv> [carpeta-salida]')
        process.exit(1)
    }

    const texto = (await readFile(entrada, 'utf8')).replace(/^﻿/, '')
    const lineas = texto.split(/\r?\n/).filter((l) => ES_FILA_DE_DATOS.test(l))

    // Agrupamos por fecha: un archivo por día, como los boletines diarios
    const porFecha = new Map()
    const errores = []
    const sospechosos = []
    lineas.forEach((linea, i) => {
        const celdas = parsearLineaCsv(linea)
        if (celdas.length !== 11) {
            errores.push(`Fila de datos ${i + 1}: tiene ${celdas.length} columnas en vez de 11`)
            return
        }
        // El reporte semanal pasa por Excel, que convierte en fecha cualquier
        // número ("42" → "10/02/1900"). No lo corregimos solos (podría ser un
        // texto que de verdad es una fecha): avisamos con el valor probable
        // para verificarlo en DINAPI y corregir el CSV a mano.
        celdas.slice(1).forEach((valor, j) => {
            if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(valor.trim())) {
                sospechosos.push(`Expediente ${celdas[1]}: columna ${j + 2} = "${valor}" → probablemente "${serialDeExcel(valor.trim())}"`)
            }
        })
        const { fecha, celdas: convertidas } = convertirFila(celdas)
        if (!porFecha.has(fecha)) porFecha.set(fecha, [])
        porFecha.get(fecha).push(convertidas.map(celdaCsv).join(','))
    })

    for (const [fecha, filas] of porFecha) {
        const destino = path.join(salida, `${fecha}.csv`)
        if (await existe(destino)) {
            console.log(`${fecha}: ya existe ${destino}, no se pisa (${filas.length} filas)`)
            continue
        }
        await writeFile(destino, BOM + [ENCABEZADO, ...filas].join('\n') + '\n', 'utf8')
        console.log(`${fecha}: ${filas.length} filas → ${destino}`)
    }

    if (sospechosos.length > 0) {
        console.log(`REVISAR A MANO: ${sospechosos.length}`)
        sospechosos.forEach((s) => console.log(`  - ${s}`))
    }

    if (errores.length > 0) {
        console.log(`Con error: ${errores.length}`)
        errores.forEach((e) => console.log(`  - ${e}`))
    }
}

main().catch((err) => {
    console.error(err)
    process.exit(1)
})
