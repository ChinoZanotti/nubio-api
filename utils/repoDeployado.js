// Para los scripts que cambian datos de producción usando el código de esta
// PC (depurar-alertas, suspender/reactivar-cuenta): el motor que decide es el
// de esta PC, y tiene que ser el mismo que corre en Render.
//
// Contra una base que no es local exige (revisión de Case de la etapa 1, M2):
// - que git funcione (antes, si fallaba, se leía "sin cambios" y seguía);
// - estar en main, sin cambios sin commitear;
// - que main sea el de GitHub (origin/main, después de un fetch): lo que Render
//   deploya. Con eso, correrlo desde la carpeta de desarrollo en otra rama, o
//   con un main atrasado, se frena.
// Lo lógico es correrlos desde c:\dev\nubio-api-produccion (docs/importar-boletines.md).
import { spawnSync } from 'node:child_process'

function git(...args) {
    const r = spawnSync('git', args, { encoding: 'utf8' })
    if (r.error || r.status !== 0) {
        throw new Error(`git ${args.join(' ')} falló: ${(r.error?.message ?? r.stderr ?? '').trim()}`)
    }
    return r.stdout.trim()
}

export const esBaseLocal = (host) => ['localhost', '127.0.0.1', '[::1]'].includes(host)

// Devuelve { commit, resumen } para mostrar. Si la base no es local y el repo no
// es exactamente el main publicado, devuelve además { problema } con el motivo.
export function revisarRepo(host) {
    let commit
    let rama
    let sucio
    try {
        commit = git('rev-parse', '--short', 'HEAD')
        rama = git('rev-parse', '--abbrev-ref', 'HEAD')
        sucio = git('status', '--porcelain') !== ''
    } catch (err) {
        return { commit: 'desconocido', resumen: 'git no disponible', problema: esBaseLocal(host) ? null : err.message }
    }
    const resumen = `${rama} @ ${commit}${sucio ? ' CON CAMBIOS SIN COMMITEAR' : ''}`
    if (esBaseLocal(host)) return { commit, resumen, problema: null }

    if (sucio) return { commit, resumen, problema: 'el repo tiene cambios sin commitear' }
    if (rama !== 'main') return { commit, resumen, problema: `está en la rama ${rama}, no en main (usá c:\\dev\\nubio-api-produccion)` }
    try {
        git('fetch', '--quiet', 'origin', 'main')
        const publicado = git('rev-parse', '--short', 'origin/main')
        if (publicado !== commit) {
            return { commit, resumen, problema: `main local (${commit}) no es el publicado (${publicado}): hacé git pull` }
        }
    } catch (err) {
        return { commit, resumen, problema: `no se pudo comparar con GitHub: ${err.message}` }
    }
    return { commit, resumen, problema: null }
}
