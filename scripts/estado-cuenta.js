// Suspende o reactiva una cuenta, mientras no exista el panel comercial
// (etapa 1, noviembre 2026; sql/014_cuentas_estado.sql).
//
//   npm run suspender-cuenta -- --cuenta=N            muestra qué haría
//   npm run suspender-cuenta -- --cuenta=N --aplicar  suspende
//   npm run reactivar-cuenta -- --cuenta=N            muestra qué haría
//   npm run reactivar-cuenta -- --cuenta=N --aplicar  reactiva y genera las
//                                                     alertas que se perdió
//
// Suspender: no puede iniciar sesión, sus sesiones abiertas se cortan (el
// servidor se entera en hasta 30 s, por su caché) y el motor deja de generarle
// alertas. No se borra nada.
// Reactivar: vuelve a entrar y se le generan las alertas que se perdió contra
// lo que sigue en plazo de oposición (las ya vencidas no sirven). Las que ya
// tenía quedan como estaban. Si se corta a la mitad, volver a correr
// `reactivar-cuenta -- --cuenta=N --aplicar`: con la cuenta ya activa, genera
// igual las que falten (revisión de Case, M1). No duplica: una alerta por par.
// No reactivar mientras se importa un boletín (Case, B4): podría quedar sin
// las alertas de ese boletín (se arregla con recalcular-alertas).
//
// Contra producción: desde c:\dev\nubio-api-produccion (main), con DATABASE_URL
// de Neon solo para este comando y después `Remove-Item Env:DATABASE_URL`. El
// motor que genera las alertas es el de esta PC: tiene que ser el deployado
// (utils/repoDeployado.js lo exige).
import 'dotenv/config'
import { crearDb } from '../db.js'
import { revisarRepo } from '../utils/repoDeployado.js'
import { suspenderCuenta, reactivarCuenta } from '../services/cuentas.js'
import { generarAlertasParaMarcas } from '../services/alertas.js'

const accion = process.argv[2] // 'suspender' | 'reactivar' (lo pone package.json)
const argCuenta = process.argv.find((a) => a.startsWith('--cuenta='))
const cuentaId = argCuenta ? Number(argCuenta.split('=')[1]) : NaN
const aplicar = process.argv.includes('--aplicar')
if (!['suspender', 'reactivar'].includes(accion) || !Number.isInteger(cuentaId) || cuentaId <= 0) {
    console.error('Uso: npm run suspender-cuenta -- --cuenta=N [--aplicar]  |  npm run reactivar-cuenta -- --cuenta=N [--aplicar]')
    process.exit(1)
}

// De a cuántas marcas se generan las alertas al reactivar (como el tope de
// una importación): no carga todo en memoria de una vez.
const TANDA = 500

async function generarPerdidas(db, marcaIds) {
    let nuevas = 0
    for (let i = 0; i < marcaIds.length; i += TANDA) {
        nuevas += await generarAlertasParaMarcas(db, marcaIds.slice(i, i + TANDA))
        console.log(`  alertas: ${Math.min(i + TANDA, marcaIds.length)} de ${marcaIds.length} marcas revisadas`)
    }
    console.log(`Alertas nuevas (las que se perdió mientras estuvo suspendida): ${nuevas}.`)
}

async function main() {
    const host = new URL(process.env.DATABASE_URL).hostname
    const repo = revisarRepo(host)
    console.log(`Base: ${host}${aplicar ? '' : ' (solo mostrar, sin cambiar nada)'}`)
    console.log(`Código: ${repo.resumen}`)
    if (aplicar && repo.problema) {
        console.error(`Contra una base que no es local hace falta el código deployado: ${repo.problema}.`)
        process.exit(1)
    }

    const db = crearDb()
    try {
        const cuenta = await db('cuentas').where({ id: cuentaId }).first('id', 'nombre', 'estado', 'estado_desde')
        if (!cuenta) {
            console.error(`No existe la cuenta ${cuentaId}.`)
            process.exitCode = 1
            return
        }
        const { usuarios } = await db('users').where({ cuenta_id: cuentaId }).count('* as usuarios').first()
        const { marcas } = await db('marcas').where({ cuenta_id: cuentaId }).count('* as marcas').first()
        console.log(`Cuenta ${cuenta.id} «${cuenta.nombre}»: ${cuenta.estado} desde ${new Date(cuenta.estado_desde).toLocaleString('es-PY', { timeZone: 'America/Asuncion' })}, ${usuarios} usuario(s), ${marcas} marca(s).`)

        const destino = accion === 'suspender' ? 'suspendida' : 'activa'
        if (cuenta.estado === destino) {
            // Reactivar una cuenta ya activa con --aplicar: retoma la generación
            // de alertas si una corrida anterior se cortó (no duplica).
            if (accion === 'reactivar' && aplicar) {
                console.log('Ya está activa: genero igual las alertas que falten (por si una corrida anterior se cortó).')
                await generarPerdidas(db, await db('marcas').where({ cuenta_id: cuentaId }).pluck('id'))
                return
            }
            console.log(`Ya está ${destino}: no hay nada que hacer.`)
            return
        }
        if (!aplicar) {
            console.log(accion === 'suspender'
                ? 'Al aplicar: no va a poder iniciar sesión, se cortan sus sesiones y deja de recibir alertas.'
                : 'Al aplicar: vuelve a poder entrar y se generan las alertas que se perdió (contra lo que sigue en plazo).')
            console.log(`Para aplicar: npm run ${accion}-cuenta -- --cuenta=${cuentaId} --aplicar`)
            return
        }

        if (accion === 'suspender') {
            const resultado = await suspenderCuenta(db, cuentaId, { origen: 'script' })
            console.log(`Resultado: ${resultado}.`)
            return
        }

        const { resultado, marcaIds } = await reactivarCuenta(db, cuentaId, { origen: 'script' })
        console.log(`Resultado: ${resultado}.`)
        if (resultado !== 'reactivada') return
        await generarPerdidas(db, marcaIds)
    } finally {
        await db.destroy()
    }
}

main().catch((err) => {
    console.error(err)
    process.exit(1)
})
