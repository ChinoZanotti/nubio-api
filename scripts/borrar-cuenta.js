// Borra una cuenta y todo lo suyo: usuarios, login, marcas, alertas, datos
// administrativos, notas, pagos y links (services/borrarCuenta.js). Para
// cancelaciones y cuentas de prueba: el panel no borra (decisión de noviembre
// 2026). NO SE PUEDE DESHACER. Pasos completos en docs/borrar-cuenta.md.
//
//   npm run borrar-cuenta -- --buscar=texto   busca por nombre o correo (para saber el número)
//   npm run borrar-cuenta -- --cuenta=N       muestra qué se borraría y, si se puede,
//                                             pregunta antes de borrar
//
// La confirmación es interactiva (revisión de Case, M3 y B4): después de
// mostrar la base y todo lo que se borra, pide escribir el número y el nombre
// de la cuenta. No va en la línea de comandos: no queda en el historial de
// PowerShell, no pasa por el shell (nombres con comillas) y no se puede pegar
// un comando sin mirar. Si entre lo que se mostró y el borrado cambió algo, no
// se borra nada.
//
// Contra producción además exige (Case, M3):
// - el código de main publicado (utils/repoDeployado.js), desde
//   c:\dev\nubio-api-produccion;
// - un backup de ESTA base de menos de 2 horas (`npm run backup`), buscado en
//   la carpeta de los backups (BACKUP_DIR de %USERPROFILE%\.nubio\backup.env).
// Con DATABASE_URL de Neon solo para este comando, y después
// `Remove-Item Env:DATABASE_URL`.
import 'dotenv/config'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import dotenv from 'dotenv'
import { crearDb } from '../db.js'
import { revisarRepo, esBaseLocal } from '../utils/repoDeployado.js'
import { borrarCuenta, contenidoDeCuenta } from '../services/borrarCuenta.js'
import { ORIGEN } from '../services/auditoria.js'

const HORAS_BACKUP = 2
const arg = (nombre) => process.argv.find((a) => a.startsWith(`--${nombre}=`))?.split('=').slice(1).join('=')
const buscar = arg('buscar')
const textoCuenta = arg('cuenta')
const USO = 'Uso: npm run borrar-cuenta -- --buscar=texto  |  npm run borrar-cuenta -- --cuenta=N'

// Solo cifras: "0x1A" o "1e1" no son un número de cuenta (Case, B6)
if (!buscar && !/^\d+$/.test(textoCuenta ?? '')) {
    console.error(USO)
    process.exit(1)
}
const cuentaId = Number(textoCuenta)

// "carlos@estudio.com" → "c***@estudio.com": alcanza para reconocerlo (B6)
const enmascarar = (email) => (email ? email.replace(/^(.)[^@]*/, '$1***') : '(sin usuario)')
const resumen = (c) => `${c.usuarios} usuario(s), ${c.marcas} marca(s), ${c.alertas} alerta(s), ${c.pagos} pago(s), ${c.notas} nota(s), ${c.links} link(s) de acceso`
// El proyecto de Neon de un host: "ep-algo-123456-pooler.c-2..." → "ep-algo-123456"
const proyecto = (host) => host.split('.')[0].replace(/-pooler$/, '')

// El backup más nuevo de la carpeta de backups, si es de esta base.
// Devuelve un problema (texto) o null.
function revisarBackup(host) {
    const archivoConfig = process.env.NUBIO_BACKUP_ENV ?? join(homedir(), '.nubio', 'backup.env')
    // Se lee sin cargarlo en el entorno: tiene la contraseña del rol de backup
    const config = existsSync(archivoConfig) ? dotenv.parse(readFileSync(archivoConfig)) : {}
    let hostBackup
    try { hostBackup = new URL(config.BACKUP_DATABASE_URL ?? '').hostname } catch { hostBackup = null }
    if (!hostBackup) return `no encontré la configuración de los backups (${archivoConfig})`
    if (proyecto(hostBackup) !== proyecto(host)) return 'los backups son de otra base que esta'
    const carpeta = resolve(config.BACKUP_DIR ?? join(homedir(), 'Backups', 'nubio'))
    const dumps = existsSync(carpeta) ? readdirSync(carpeta).filter((f) => /^nubio-.*\.dump$/.test(f)) : []
    const masNuevo = Math.max(0, ...dumps.map((f) => statSync(join(carpeta, f)).mtimeMs))
    const horas = (Date.now() - masNuevo) / 3_600_000
    if (!masNuevo) return `no hay backups en ${carpeta}`
    if (horas > HORAS_BACKUP) return `el backup más nuevo es de hace ${Math.floor(horas)} horas`
    return null
}

async function preguntar(texto) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    try {
        return (await rl.question(texto)).trim()
    } finally {
        rl.close()
    }
}

async function main() {
    const host = new URL(process.env.DATABASE_URL).hostname
    const repo = revisarRepo(host)
    console.log(`Base: ${host}`)
    console.log(`Código: ${repo.resumen}`)

    const db = crearDb()
    try {
        if (buscar) {
            // Los comodines de LIKE se buscan como texto (B6)
            const texto = `%${buscar.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`
            const filas = await db('cuentas as c')
                .leftJoin('users as u', 'u.cuenta_id', 'c.id')
                .whereRaw("lower(c.nombre) LIKE ? ESCAPE '\\'", [texto]).orWhereRaw("lower(u.email) LIKE ? ESCAPE '\\'", [texto])
                .orderBy('c.id').limit(20)
                .select('c.id', 'c.nombre', 'c.estado', 'u.email')
            if (filas.length === 0) console.log('Ninguna cuenta coincide.')
            for (const f of filas) console.log(`  ${f.id}  «${f.nombre}»  ${f.estado}  ${enmascarar(f.email)}`)
            return
        }

        const contenido = await contenidoDeCuenta(db, cuentaId)
        if (!contenido) {
            console.error(`No existe la cuenta ${cuentaId}.`)
            process.exitCode = 1
            return
        }
        const { cuenta, usuarios, cantidades, ajenas } = contenido
        console.log(`\nCuenta ${cuenta.id} «${cuenta.nombre}» (${cuenta.estado}): ${resumen(cantidades)}.`)
        for (const u of usuarios) console.log(`  usuario: ${enmascarar(u.email)}`)

        // Lo que impide borrarla, de una vez
        const problemas = []
        if (cuenta.estado !== 'suspendida') problemas.push('no está suspendida: suspendela primero (desde el panel o con npm run suspender-cuenta)')
        else if (cuenta.minutos_en_estado < 2) problemas.push('se suspendió hace menos de 2 minutos: esperá un poco (las sesiones y el motor tardan en enterarse)')
        if (ajenas.marcas) problemas.push(`${ajenas.marcas} marca(s) de OTRA cuenta las cargó un usuario de esta (se lo movió de cuenta): borrarlo se las llevaría. Revisalo a mano`)
        if (ajenas.correos) problemas.push('el correo de un usuario de esta cuenta está también en otra')
        if (!esBaseLocal(host)) {
            if (repo.problema) problemas.push(`hace falta el código deployado: ${repo.problema}`)
            const backup = revisarBackup(host)
            if (backup) problemas.push(`hace falta un backup de esta base de hace menos de ${HORAS_BACKUP} horas (npm run backup): ${backup}`)
        }
        if (problemas.length) {
            console.log('\nNo se puede borrar todavía:')
            for (const p of problemas) console.log(`  - ${p}.`)
            process.exitCode = 1
            return
        }

        console.log('\nSe va a borrar TODO lo de arriba y no se puede deshacer.')
        const respuesta = await preguntar(`Para confirmar, escribí el número y el nombre de la cuenta (por ejemplo: ${cuenta.id} Nombre de la cuenta): `)
        const esperado = `${cuenta.id} ${cuenta.nombre}`
        if (respuesta !== esperado) {
            console.log('No coincide: no se borró nada.')
            process.exitCode = 1
            return
        }

        const r = await borrarCuenta(db, cuentaId, { nombre: cuenta.nombre, cantidades }, { origen: ORIGEN.script })
        const mensajes = {
            borrada: `Borrada: ${r.cantidades && resumen(r.cantidades)}.`,
            no_existe: `No se borró nada: la cuenta ${cuentaId} ya no existe.`,
            no_suspendida: 'No se borró nada: la cuenta ya no está suspendida (¿la reactivaron?).',
            suspendida_hace_poco: 'No se borró nada: se suspendió hace menos de 2 minutos.',
            nombre_distinto: 'No se borró nada: el nombre de la cuenta cambió mientras tanto.',
            cantidades_distintas: `No se borró nada: la cuenta cambió desde que la viste (ahora: ${r.cantidades && resumen(r.cantidades)}). Volvé a correr el comando.`,
            toca_otra_cuenta: 'No se borró nada: tocaría datos de otra cuenta.',
            tablas_desconocidas: `No se borró nada: la base tiene datos que dependen de la cuenta que este script no conoce (${r.claves?.join(', ')}). Sumalos a services/borrarCuenta.js.`,
        }
        console.log(mensajes[r.resultado])
        if (r.resultado !== 'borrada') process.exitCode = 1
    } finally {
        await db.destroy()
    }
}

main().catch((err) => {
    console.error(err.code === '55P03' ? 'No se borró nada: otra operación tenía datos de la cuenta bloqueados. Probá de nuevo en un rato.' : err)
    process.exit(1)
})
