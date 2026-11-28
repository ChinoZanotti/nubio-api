// La cuota de una cuenta leída de la base (panel comercial, etapa 4): lo usan
// la ficha y la lista del panel (controllers/admin/) y el aviso de la app de
// clientes (controllers/cuota.js). Las reglas están en utils/cuotas.js.
import { estadoCuota, hoyEnParaguay, mesesDelPeriodo, proximoDesde } from '../utils/cuotas.js'

// Lo que hace falta para calcular la cuota de una cuenta. `dbOTrx`: dentro de
// una transacción, después del FOR UPDATE.
export async function datosDeCuota(dbOTrx, cuentaId) {
    const cuenta = await dbOTrx('cuentas').where({ id: cuentaId }).first('id', 'estado')
    if (!cuenta) return null
    const facturacion = await dbOTrx('cuentas_facturacion').where({ cuenta_id: cuentaId })
        .first('modalidad', 'dia_pago', 'fecha_ingreso', 'medio_pago', 'monto_mensual', 'version')
    const { pagado_hasta: pagadoHasta } = await dbOTrx('pagos_cuenta').where({ cuenta_id: cuentaId }).whereNull('anulado_at')
        .max('hasta as pagado_hasta').first()
    // La última reactivación, como fecha de Paraguay (la deja services/cuentas.js)
    const { dia: reactivadaEl } = await dbOTrx('auditoria_admin').where({ cuenta_id: cuentaId, accion: 'cuenta_reactivada' })
        .first(dbOTrx.raw("to_char(max(created_at) AT TIME ZONE 'America/Asuncion', 'YYYY-MM-DD') AS dia"))
    return { cuenta, facturacion, pagadoHasta: pagadoHasta ?? null, reactivadaEl: reactivadaEl ?? null }
}

// La cuota para el aviso de la app de clientes: SOLO el estado de la cuenta,
// la modalidad y el máximo `hasta`. No lee montos, medio de pago ni la
// auditoría (Case, B2 de la etapa 4: cuentas_facturacion es de las rutas
// /admin, y así un cambio futuro no puede filtrar lo que no se leyó).
export async function cuotaDelCliente(db, cuentaId, hoy = hoyEnParaguay()) {
    const fila = await db('cuentas as c')
        .leftJoin('cuentas_facturacion as f', 'f.cuenta_id', 'c.id')
        .where('c.id', cuentaId)
        .first('c.estado', 'f.modalidad',
            db.raw('(SELECT max(hasta) FROM pagos_cuenta p WHERE p.cuenta_id = c.id AND p.anulado_at IS NULL) AS pagado_hasta'))
    if (!fila) return { estado: 'sin_pagos', pagado_hasta: null, dias: null }
    const { estado, dias } = estadoCuota({ pagadoHasta: fila.pagado_hasta, modalidad: fila.modalidad, suspendida: fila.estado === 'suspendida' }, hoy)
    return { estado, pagado_hasta: fila.pagado_hasta, dias }
}

// La cuota como la ve la ficha: estado, "pagado hasta" y el próximo período
export function resumenCuota({ cuenta, facturacion, pagadoHasta, reactivadaEl }, hoy = hoyEnParaguay()) {
    const suspendida = cuenta.estado === 'suspendida'
    const { estado, dias } = estadoCuota({ pagadoHasta, modalidad: facturacion?.modalidad, suspendida }, hoy)
    return {
        estado, dias, pagado_hasta: pagadoHasta,
        proximo_desde: proximoDesde({ pagadoHasta, fechaIngreso: facturacion?.fecha_ingreso, suspendida, reactivadaEl }, hoy),
        meses: mesesDelPeriodo(facturacion?.modalidad),
    }
}

