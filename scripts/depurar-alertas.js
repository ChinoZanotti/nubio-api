// Revisa las alertas que ya existen con las reglas ACTUALES del motor:
// - borra las que ya no corresponden, SOLO si nadie las tocó (ver sinTocar en
//   services/alertas.js: estado "nueva", sin nota y sin modificar nunca);
// - a las que siguen, les actualiza el puntaje, el nivel, los motivos y la
//   relación de clase, que calcula el motor (revisión de Case del motor, B1).
// Es lo contrario de recalcular-alertas (que solo agrega). Sirve después de un
// ajuste del motor que DESCARTA más: la regla del mismo titular, una palabra
// descriptiva nueva.
//
//   npm run depurar-alertas                 solo cuenta, no cambia nada
//   npm run depurar-alertas -- --aplicar=N  borra y actualiza; N es el número
//                                           de alertas a borrar que mostró la
//                                           corrida anterior
//
// Medidas para no borrar de más en producción (revisión de Case, M2):
// - --aplicar exige el número: si el recálculo da otro (el motor cambió, otra
//   persona tocó alertas), no hace nada.
// - Contra una base que no es local, exige el código deployado: main publicado
//   y sin cambios (utils/repoDeployado.js). El motor que decide es el de esta
//   PC: correrlo desde c:\dev\nubio-api-produccion. Imprime el commit.
ubio-api-produccion. Imprime el commit.
// - Antes de borrar, guarda las filas borradas en ~/.nubio/depuraciones/
//   (fuera del repo; sin nombres de clientes, solo ids y puntajes), para poder
//   restaurarlas con un INSERT.
// - Todo va en UNA transacción: si se corta, no queda nada a medias.
//
// No correr recalcular-alertas después: compara contra TODOS los boletines,
// también los de plazo vencido, y llenaría Alertas de publicaciones que ya no
// se pueden oponer.
//
// Contra producción: DATABASE_URL de Neon solo para este comando, y al
// terminar `Remove-Item Env:DATABASE_URL` en PowerShell, para no dejar la
// terminal apuntando a producción. Mejor con el estudio sin usar la app.
import 'dotenv/config'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { crearDb } from '../db.js'
import { prepararMarca } from '../utils/similitud/index.js'
import { evaluarPar, sinTocar } from '../services/alertas.js'
import { revisarRepo } from '../utils/repoDeployado.js'

const TANDA = 1000
const argAplicar = process.argv.find((a) => a.startsWith('--aplicar'))
const esperado = argAplicar ? Number(argAplicar.split('=')[1]) : null
if (argAplicar && !Number.isInteger(esperado)) {
    console.error('Uso: npm run depurar-alertas -- --aplicar=N (N = alertas a borrar según la corrida sin --aplicar)')
    process.exit(1)
}
if (process.argv.includes('--borrar')) {
    console.error('--borrar ya no existe: usá --aplicar=N, con el número que muestra la corrida sin opciones.')
    process.exit(1)
}

async function main() {
    const host = new URL(process.env.DATABASE_URL).hostname
    // Contra producción, el motor tiene que ser el deployado: main publicado y
    // sin cambios (utils/repoDeployado.js; revisión de Case de la etapa 1, M2).
    const repo = revisarRepo(host)
    const { commit } = repo
    console.log(`Base: ${host}${argAplicar ? '' : ' (solo contar, sin cambiar nada)'}`)
    console.log(`Motor: ${repo.resumen}`)
    if (argAplicar && repo.problema) {
        console.error(`Contra una base que no es local hace falta el código deployado: ${repo.problema}.`)
        process.exit(1)
    }

    const db = crearDb()
    try {
        const filas = await db('alertas as a')
            .join('marcas as m', 'm.id', 'a.marca_id')
            .join('boletin_marcas as b', 'b.id', 'a.boletin_marca_id')
            .select(
                'a.id', 'a.marca_id', 'a.boletin_marca_id', 'a.score', 'a.nivel', 'a.motivos', 'a.relacion_clase',
                'a.estado', 'a.nota', 'a.created_at', 'a.updated_at', 'm.cuenta_id',
                'm.expediente as m_expediente', 'm.clase_niza as m_clase', 'm.denominacion as m_denominacion',
                'm.signo as m_signo', 'm.titular as m_titular', 'm.pais as m_pais',
                'b.expediente as b_expediente', 'b.clase_niza as b_clase', 'b.denominacion as b_denominacion',
                'b.signo as b_signo', 'b.titular as b_titular', 'b.pais as b_pais', 'b.tramite as b_tramite',
            )

        // Cada marca se prepara una vez (normalizar y claves fonéticas es lo caro)
        const cache = new Map()
        const preparar = (clave, marca) => {
            if (!cache.has(clave)) cache.set(clave, prepararMarca(marca))
            return cache.get(clave)
        }
        const intacta = (f) => f.estado === 'nueva' && f.nota === null
            && new Date(f.updated_at).getTime() === new Date(f.created_at).getTime()

        const aBorrar = []
        const aActualizar = []
        const porMotivo = {}
        const porCuenta = {}
        let tocadasQueNoCorresponden = 0
        for (const f of filas) {
            const marca = { expediente: f.m_expediente, clase_niza: f.m_clase, denominacion: f.m_denominacion, signo: f.m_signo, titular: f.m_titular, pais: f.m_pais }
            const publicada = { expediente: f.b_expediente, clase_niza: f.b_clase, denominacion: f.b_denominacion, signo: f.b_signo, titular: f.b_titular, pais: f.b_pais, tramite: f.b_tramite }
            const { descarte, resultado } = evaluarPar(marca, publicada, preparar(`m${f.marca_id}`, marca), preparar(`b${f.boletin_marca_id}`, publicada))

            if (descarte) {
                if (intacta(f)) {
                    aBorrar.push({ ...f, motivo: descarte })
                    porMotivo[descarte] = (porMotivo[descarte] ?? 0) + 1
                    porCuenta[f.cuenta_id] = (porCuenta[f.cuenta_id] ?? 0) + 1
                } else {
                    tocadasQueNoCorresponden++
                }
                continue
            }
            const cambio = resultado.score !== f.score || resultado.nivel !== f.nivel
                || resultado.relacionClase !== f.relacion_clase
                || JSON.stringify(resultado.motivos) !== JSON.stringify(f.motivos)
            if (cambio) aActualizar.push({ id: f.id, score: resultado.score, nivel: resultado.nivel, motivos: resultado.motivos, relacion_clase: resultado.relacionClase })
        }

        console.log(`Alertas revisadas: ${filas.length}`)
        console.log(`A borrar (ya no corresponden y nadie las tocó): ${aBorrar.length}`)
        for (const [motivo, n] of Object.entries(porMotivo)) console.log(`   ${motivo}: ${n}`)
        for (const [cuenta, n] of Object.entries(porCuenta)) console.log(`   cuenta ${cuenta}: ${n}`)
        console.log(`Ya no corresponden pero alguien las tocó (se dejan): ${tocadasQueNoCorresponden}`)
        console.log(`A actualizar (siguen, con otro puntaje o motivos): ${aActualizar.length}`)

        if (!argAplicar) {
            console.log(`No se cambió nada. Para aplicar: npm run depurar-alertas -- --aplicar=${aBorrar.length}`)
            return
        }
        if (esperado !== aBorrar.length) {
            console.error(`Se esperaban ${esperado} alertas a borrar y ahora son ${aBorrar.length}: no se cambió nada. Volvé a correr sin --aplicar y revisá.`)
            process.exitCode = 1
            return
        }

        // Copia de lo que se borra, fuera del repo, ANTES de borrar
        const carpeta = join(homedir(), '.nubio', 'depuraciones')
        mkdirSync(carpeta, { recursive: true })
        const archivo = join(carpeta, `depuracion-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
        const copia = aBorrar.map(({ id, marca_id, boletin_marca_id, score, nivel, motivos, relacion_clase, estado, created_at, updated_at, motivo }) =>
            ({ id, marca_id, boletin_marca_id, score, nivel, motivos, relacion_clase, estado, created_at, updated_at, motivo }))
        writeFileSync(archivo, JSON.stringify({ base: host, commit, fecha: new Date().toISOString(), alertas: copia }, null, 2), { mode: 0o600 })
        console.log(`Copia de las alertas a borrar: ${archivo}`)

        let borradas = 0
        let actualizadas = 0
        await db.transaction(async (trx) => {
            const ids = aBorrar.map((a) => a.id)
            for (let i = 0; i < ids.length; i += TANDA) {
                // sinTocar se repite en el DELETE: si alguien tocó una alerta
                // mientras corría el script, no se borra.
                borradas += await sinTocar(trx('alertas').whereIn('id', ids.slice(i, i + TANDA))).del()
            }
            // Sin tocar updated_at: el puntaje lo calcula el motor, no la persona,
            // y updated_at es lo que dice si alguien trabajó la alerta.
            for (const a of aActualizar) {
                actualizadas += await trx('alertas').where({ id: a.id })
                    .update({ score: a.score, nivel: a.nivel, motivos: a.motivos, relacion_clase: a.relacion_clase })
            }
        })
        console.log(`Borradas: ${borradas}. Actualizadas: ${actualizadas}.`)
    } finally {
        await db.destroy()
    }
}

main().catch((err) => {
    console.error(err)
    process.exit(1)
})
