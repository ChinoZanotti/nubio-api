// Estado de las cuentas: suspender y reactivar (panel comercial, etapa 1,
// noviembre 2026; sql/014_cuentas_estado.sql).
//
// Lo usan los scripts (npm run suspender-cuenta / reactivar-cuenta) y las rutas
// del panel comercial. La decisión la toma siempre una persona: nada de esto
// corre solo (decidido con Carlos: ni al vencer la cuota).
//
// Cada cambio queda en auditoria_admin (sql/015) en la MISMA transacción.
// `quien` = { origen: 'script' | 'panel', operadorId, ip }.
import { recordar } from '../utils/versionToken.js'
import { registrarAuditoria } from './auditoria.js'

export const CODIGO_CUENTA_SUSPENDIDA = 'cuenta_suspendida'
// Lo ve la persona en el login. El link de soporte por WhatsApp está en la
// misma pantalla, debajo del formulario.
export const MENSAJE_CUENTA_SUSPENDIDA = 'Tu cuenta está suspendida. Para reactivarla, escribinos por WhatsApp.'

// Suspende una cuenta activa. El trigger de sql/014 sube token_version de sus
// usuarios en la misma sentencia: las sesiones abiertas se cortan.
// Devuelve 'suspendida', 'ya_estaba' o 'no_existe'.
export async function suspenderCuenta(db, cuentaId, quien) {
    const usuarios = await db.transaction(async (trx) => {
        const [cambiada] = await trx('cuentas')
            .where({ id: cuentaId, estado: 'activa' })
            .update({ estado: 'suspendida' })
            .returning('id')
        if (!cambiada) return null
        const filas = await trx('users').where({ cuenta_id: cuentaId }).select('id', 'token_version')
        await registrarAuditoria(trx, { ...quien, accion: 'cuenta_suspendida', cuentaId, detalle: { usuarios: filas.length } })
        return filas
    })
    if (!usuarios) return (await existe(db, cuentaId)) ? 'ya_estaba' : 'no_existe'

    // El caché de sesiones de ESTE proceso se entera al instante. Si lo corre
    // un script, el servidor se entera al vencer su caché (30 s) o antes, en
    // cuanto vuelva a leer la versión de la base.
    for (const u of usuarios) recordar(u.id, u.token_version, { cuentaId, activa: false })
    return 'suspendida'
}

// Reactiva una cuenta suspendida. Devuelve { resultado, marcaIds }:
// resultado es 'reactivada', 'ya_estaba' o 'no_existe'; marcaIds son las marcas
// de la cuenta, para generar las alertas que se perdió mientras estuvo
// suspendida (el motor la salteaba). Las genera quien llama: el script, de una;
// el servidor, por la fila y en tandas (tope de 1.000 por cuenta).
export async function reactivarCuenta(db, cuentaId, quien) {
    const resultado = await db.transaction(async (trx) => {
        const [cambiada] = await trx('cuentas')
            .where({ id: cuentaId, estado: 'suspendida' })
            .update({ estado: 'activa' })
            .returning('id')
        if (!cambiada) return null
        const usuarios = await trx('users').where({ cuenta_id: cuentaId }).select('id', 'token_version')
        const marcaIds = await trx('marcas').where({ cuenta_id: cuentaId }).pluck('id')
        await registrarAuditoria(trx, { ...quien, accion: 'cuenta_reactivada', cuentaId, detalle: { marcas: marcaIds.length } })
        return { usuarios, marcaIds }
    })
    if (!resultado) {
        return { resultado: (await existe(db, cuentaId)) ? 'ya_estaba' : 'no_existe', marcaIds: [] }
    }

    // Si el servidor tenía en caché "suspendida", que no rechace el primer
    // pedido después de volver a entrar (en este proceso; el servidor, a los 30 s;
    // y signin lo actualiza al loguear).
    for (const u of resultado.usuarios) recordar(u.id, u.token_version, { cuentaId, activa: true })
    return { resultado: 'reactivada', marcaIds: resultado.marcaIds }
}

async function existe(db, cuentaId) {
    return Boolean(await db('cuentas').where({ id: cuentaId }).first('id'))
}
