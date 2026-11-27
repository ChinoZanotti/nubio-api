// Estado de las cuentas: suspender y reactivar (panel comercial, etapa 1,
// noviembre 2026; sql/014_cuentas_estado.sql).
//
// Lo usan hoy los scripts (npm run suspender-cuenta / reactivar-cuenta) y
// mañana las rutas del panel comercial. La decisión la toma siempre una
// persona: nada de esto corre solo (decidido con Carlos: ni al vencer la cuota).
import { recordar } from '../utils/versionToken.js'
import { registrarEvento } from '../utils/eventos.js'

export const CODIGO_CUENTA_SUSPENDIDA = 'cuenta_suspendida'
// Lo ve la persona en el login. El link de soporte por WhatsApp está en la
// misma pantalla, debajo del formulario.
export const MENSAJE_CUENTA_SUSPENDIDA = 'Tu cuenta está suspendida. Para reactivarla, escribinos por WhatsApp.'

// Suspende una cuenta activa. El trigger de sql/014 sube token_version de sus
// usuarios en la misma sentencia: las sesiones abiertas se cortan.
// Devuelve 'suspendida', 'ya_estaba' o 'no_existe'.
// `origen`: quién lo hizo, para el registro ('script' hoy; el operador mañana).
export async function suspenderCuenta(db, cuentaId, { origen }) {
    const [cambiada] = await db('cuentas')
        .where({ id: cuentaId, estado: 'activa' })
        .update({ estado: 'suspendida' })
        .returning('id')
    if (!cambiada) return (await existe(db, cuentaId)) ? 'ya_estaba' : 'no_existe'

    // El caché de sesiones de ESTE proceso se entera al instante. Si lo corre
    // un script, el servidor se entera al vencer su caché (30 s) o antes, en
    // cuanto vuelva a leer la versión de la base.
    const usuarios = await db('users').where({ cuenta_id: cuentaId }).select('id', 'token_version')
    for (const u of usuarios) recordar(u.id, u.token_version, { cuentaId, activa: false })

    registrarEvento('cuenta_suspendida', { cuenta_id: cuentaId, origen, usuarios: usuarios.length })
    return 'suspendida'
}

// Reactiva una cuenta suspendida. Devuelve { resultado, marcaIds }:
// resultado es 'reactivada', 'ya_estaba' o 'no_existe'; marcaIds son las marcas
// de la cuenta, para generar las alertas que se perdió mientras estuvo
// suspendida (el motor la salteaba). Las genera quien llama: el script, de una;
// el servidor, por la fila y en tandas (tope de 1.000 por cuenta).
export async function reactivarCuenta(db, cuentaId, { origen }) {
    const [cambiada] = await db('cuentas')
        .where({ id: cuentaId, estado: 'suspendida' })
        .update({ estado: 'activa' })
        .returning('id')
    if (!cambiada) {
        return { resultado: (await existe(db, cuentaId)) ? 'ya_estaba' : 'no_existe', marcaIds: [] }
    }

    // Si el servidor tenía en caché "suspendida", que no rechace el primer
    // pedido después de volver a entrar (en este proceso; el servidor, a los 30 s).
    const usuarios = await db('users').where({ cuenta_id: cuentaId }).select('id', 'token_version')
    for (const u of usuarios) recordar(u.id, u.token_version, { cuentaId, activa: true })

    const marcaIds = await db('marcas').where({ cuenta_id: cuentaId }).pluck('id')
    registrarEvento('cuenta_reactivada', { cuenta_id: cuentaId, origen, marcas: marcaIds.length })
    return { resultado: 'reactivada', marcaIds }
}

async function existe(db, cuentaId) {
    return Boolean(await db('cuentas').where({ id: cuentaId }).first('id'))
}
