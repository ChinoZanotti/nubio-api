// Pagos de las cuentas en el panel comercial (etapa 4; tabla pagos_cuenta,
// sql/017). Las reglas de los períodos están en utils/cuotas.js.
//
//   POST /admin/cuentas/:id/pagos
//        { fecha_pago, monto, medio_pago, desde, pagado_hasta_visto, facturacion_version_vista, acepta_hueco }
//   POST /admin/cuentas/:id/pagos/:pagoId/anular { motivo }
//
// - Registrar y anular bloquean la fila de la cuenta (FOR UPDATE) ANTES que
//   cualquier otra, igual que "Editar datos": el mismo orden en todas las
//   rutas, para que dos no se traben entre sí (Case, M3 de la etapa 4).
// - Lo que vio quien completó el formulario tiene que seguir igual: el
//   "pagado hasta" (`pagado_hasta_visto`) y la versión de los datos de la
//   cuenta (`facturacion_version_vista`: la modalidad y el día de pago con que
//   se calculó; Case, M2). Si cambió algo, 409 `cuota_modificada`.
// - `desde` lo propone la ficha (proximoDesde) y se puede cambiar. `hasta` lo
//   calcula siempre el servidor. Dos pagos vigentes no cubren el mismo día
//   (409 `periodo_superpuesto`; lo garantiza además la base). Un período que
//   deja días sin cubrir (empieza después de lo que propone el sistema) se
//   acepta solo confirmado (`acepta_hueco`; 409 `periodo_con_hueco` si no) y
//   queda en la auditoría (Case, M1; decisión de Carlos, 28/11/2026).
// - Si el período empieza otro día (después de una suspensión), ese pasa a ser
//   el día de pago de la cuenta, en la misma transacción. El pago guarda el
//   día anterior: al anularlo se restaura, si nadie editó los datos después
//   (decisión de Carlos, 28/11/2026).
// - Solo se anula el ÚLTIMO pago vigente: los siguientes se calcularon a partir
//   de él. No se borran.
// - Auditoría sin montos: el id del pago, los meses y qué excepción hubo.
import { parseId } from '../../utils/id.js'
import { registrarError } from '../../utils/log.js'
import { MEDIOS_PAGO, MONTO_MAXIMO, normalizarMonto } from '../../utils/cuentaValidation.js'
import { calcularPeriodo, fechaValida, diasEntre, hoyEnParaguay, mesesDelPeriodo, proximoDesde } from '../../utils/cuotas.js'
import { datosDeCuota } from '../../services/cuotas.js'
import { registrarAuditoria, ORIGEN } from '../../services/auditoria.js'

export const LARGO_MAXIMO_MOTIVO = 500
const DIAS_MAXIMOS = 400 // fechas más lejos que esto, hacia atrás o adelante, son un error de tipeo
const EXCLUSION_VIOLATION = '23P01'
const DEADLOCK = '40P01'
const SERIALIZACION = '40001'
const NO_ENCONTRADA = { error: 'No encontramos esa cuenta.' }
const CUOTA_MODIFICADA = {
    error: 'Otra persona cambió esta cuenta (un pago, una anulación o sus datos) mientras completabas el formulario. Revisá los pagos y volvé a probar.',
    codigo: 'cuota_modificada',
}
const SUPERPUESTO = {
    error: 'Ese período se superpone con uno que ya está pagado. Revisá la fecha de inicio.',
    errores: { desde: 'Se superpone con un período que ya está pagado.' },
    codigo: 'periodo_superpuesto',
}
const OCUPADA = { error: 'Otra persona estaba cambiando esta cuenta en el mismo momento. Probá de nuevo.', codigo: 'cuota_modificada' }
const dma = (iso) => iso.split('-').reverse().join('/')
const quien = (req) => ({ origen: ORIGEN.panel, operadorId: req.operadorId, ip: req.ip })

function validarPago(cuerpo, hoy) {
    const errores = {}
    const fechaPago = typeof cuerpo?.fecha_pago === 'string' ? cuerpo.fecha_pago.trim() : ''
    const desde = typeof cuerpo?.desde === 'string' ? cuerpo.desde.trim() : ''
    const monto = normalizarMonto(cuerpo?.monto)
    const medioPago = typeof cuerpo?.medio_pago === 'string' ? cuerpo.medio_pago.trim() : ''
    if (!fechaValida(fechaPago)) errores.fecha_pago = 'Ingresá la fecha en que pagó.'
    else if (diasEntre(hoy, fechaPago) > 0) errores.fecha_pago = 'La fecha de pago no puede ser posterior a hoy.'
    else if (diasEntre(fechaPago, hoy) > DIAS_MAXIMOS) errores.fecha_pago = 'Revisá la fecha de pago: es de hace más de un año.'
    if (!fechaValida(desde)) errores.desde = 'Ingresá desde cuándo corre el período.'
    else if (Math.abs(diasEntre(hoy, desde)) > DIAS_MAXIMOS) errores.desde = 'Revisá la fecha: está a más de un año de hoy.'
    if (!Number.isInteger(monto) || monto <= 0) errores.monto = 'Ingresá lo que pagó, en guaraníes, solo con números: por ejemplo, 150000 o 150.000.'
    if (!MEDIOS_PAGO.includes(medioPago)) errores.medio_pago = 'Elegí el medio de pago.'
    return { errores, pago: { fecha_pago: fechaPago, desde, monto, medio_pago: medioPago } }
}

export async function handleRegistrarPago(req, res, db) {
    const id = parseId(req.params.id)
    if (!id) return res.status(400).json(NO_ENCONTRADA)
    const hoy = hoyEnParaguay()
    const { errores, pago } = validarPago(req.body, hoy)
    if (Object.keys(errores).length) return res.status(400).json({ error: Object.values(errores)[0], errores })
    const visto = req.body?.pagado_hasta_visto ?? null
    const versionVista = req.body?.facturacion_version_vista
    const aceptaHueco = req.body?.acepta_hueco === true
    try {
        const resultado = await db.transaction(async (trx) => {
            if (!(await trx('cuentas').where({ id }).forUpdate().first('id'))) return { status: 404 }
            const datos = await datosDeCuota(trx, id)
            const f = datos.facturacion
            if (!f) return { status: 409, cuerpo: { error: 'Completá los datos de la cuenta antes de registrar un pago.', codigo: 'faltan_datos' } }
            if (visto !== datos.pagadoHasta || versionVista !== f.version) return { status: 409, cuerpo: CUOTA_MODIFICADA }

            const meses = mesesDelPeriodo(f.modalidad)
            // Tope según lo que cubre: un cero de más en un pago mensual no pasa (Case, B4)
            if (pago.monto > MONTO_MAXIMO * meses) {
                const error = 'Revisá el monto: parece demasiado alto.'
                return { status: 400, cuerpo: { error, errores: { monto: error } } }
            }
            const { hasta, diaPago } = calcularPeriodo(pago.desde, f.modalidad, f.dia_pago)

            const superpuesto = await trx('pagos_cuenta').where({ cuenta_id: id }).whereNull('anulado_at')
                .where('desde', '<', hasta).where('hasta', '>', pago.desde).first('id')
            if (superpuesto) return { status: 409, cuerpo: SUPERPUESTO }

            const propuesto = proximoDesde({
                pagadoHasta: datos.pagadoHasta, fechaIngreso: f.fecha_ingreso,
                suspendida: datos.cuenta.estado === 'suspendida', reactivadaEl: datos.reactivadaEl,
            }, hoy)
            const hueco = pago.desde > propuesto
            if (hueco && !aceptaHueco) {
                return {
                    status: 409,
                    cuerpo: { error: `Del ${dma(propuesto)} al ${dma(pago.desde)} no quedaría cubierto. Confirmalo si es lo que se acordó.`, codigo: 'periodo_con_hueco', desde_propuesto: propuesto },
                }
            }

            const cambiaDia = diaPago !== f.dia_pago
            let versionFacturacion = null
            if (cambiaDia) {
                const [fila] = await trx('cuentas_facturacion').where({ cuenta_id: id })
                    .update({ dia_pago: diaPago, version: trx.raw('version + 1'), updated_at: trx.fn.now(), updated_by: req.operadorId })
                    .returning('version')
                versionFacturacion = fila.version
            }
            const [{ id: pagoId }] = await trx('pagos_cuenta')
                .insert({
                    cuenta_id: id, ...pago, hasta, meses, operador_id: req.operadorId,
                    dia_pago_anterior: cambiaDia ? f.dia_pago : null, version_facturacion: versionFacturacion,
                })
                .returning('id')
            await registrarAuditoria(trx, {
                ...quien(req), accion: 'pago_registrado', cuentaId: id,
                detalle: { pago: pagoId, meses, dia_pago_cambiado: cambiaDia, ...(hueco && { hueco: true }), ...(pago.desde !== propuesto && { desde_cambiado: true }) },
            })
            const pagadoHasta = hasta > (datos.pagadoHasta ?? '') ? hasta : datos.pagadoHasta
            return { status: 201, cuerpo: { id: pagoId, hasta, pagado_hasta: pagadoHasta, dia_pago: diaPago, dia_pago_cambiado: cambiaDia } }
        })
        if (resultado.status === 404) return res.status(404).json(NO_ENCONTRADA)
        res.status(resultado.status).json(resultado.cuerpo)
    } catch (err) {
        // La base lo frena aunque la consulta de arriba no lo viera (otra
        // transacción en el mismo instante)
        if (err.code === EXCLUSION_VIOLATION) return res.status(409).json(SUPERPUESTO)
        if (err.code === DEADLOCK || err.code === SERIALIZACION) return res.status(409).json(OCUPADA)
        registrarError('POST /admin/cuentas/:id/pagos', err)
        res.status(500).json({ error: 'No se pudo registrar el pago.' })
    }
}

export async function handleAnularPago(req, res, db) {
    const id = parseId(req.params.id)
    const pagoId = parseId(req.params.pagoId)
    if (!id || !pagoId) return res.status(400).json({ error: 'No encontramos ese pago.' })
    const motivo = typeof req.body?.motivo === 'string' ? req.body.motivo.trim() : ''
    let errorMotivo = null
    if (!motivo) errorMotivo = 'Escribí por qué se anula el pago.'
    else if (motivo.length > LARGO_MAXIMO_MOTIVO) errorMotivo = `El motivo puede tener hasta ${LARGO_MAXIMO_MOTIVO} caracteres.`
    else if (/[\p{Cc}\p{Cf}]/u.test(motivo)) errorMotivo = 'El motivo tiene caracteres que no se pueden usar.'
    if (errorMotivo) return res.status(400).json({ error: errorMotivo, errores: { motivo: errorMotivo } })
    try {
        const resultado = await db.transaction(async (trx) => {
            if (!(await trx('cuentas').where({ id }).forUpdate().first('id'))) return { status: 404 }
            const ultimo = await trx('pagos_cuenta').where({ cuenta_id: id }).whereNull('anulado_at')
                .orderBy([{ column: 'created_at', order: 'desc' }, { column: 'id', order: 'desc' }]).first('id')
            const pago = await trx('pagos_cuenta').where({ id: pagoId, cuenta_id: id })
                .first('id', 'anulado_at', 'dia_pago_anterior', 'version_facturacion')
            if (!pago) return { status: 404 }
            if (pago.anulado_at) return { status: 409, cuerpo: { error: 'Ese pago ya estaba anulado.', codigo: 'pago_anulado' } }
            if (ultimo?.id !== pagoId) {
                return { status: 409, cuerpo: { error: 'Solo se puede anular el último pago registrado. Si hace falta anular uno anterior, anulá primero los que vinieron después.', codigo: 'no_es_el_ultimo' } }
            }
            await trx('pagos_cuenta').where({ id: pagoId })
                .update({ anulado_at: trx.fn.now(), anulado_por: req.operadorId, motivo_anulacion: motivo })

            // Si el pago había cambiado el día de pago: vuelve al anterior, salvo
            // que alguien haya editado los datos después (se avisa)
            let diaRestaurado = null
            let diaNoRestaurado = false
            if (pago.dia_pago_anterior != null) {
                const restaurada = await trx('cuentas_facturacion').where({ cuenta_id: id, version: pago.version_facturacion })
                    .update({ dia_pago: pago.dia_pago_anterior, version: trx.raw('version + 1'), updated_at: trx.fn.now(), updated_by: req.operadorId })
                if (restaurada) diaRestaurado = pago.dia_pago_anterior
                else diaNoRestaurado = true
            }
            await registrarAuditoria(trx, {
                ...quien(req), accion: 'pago_anulado', cuentaId: id,
                detalle: { pago: pagoId, ...(diaRestaurado && { dia_pago_restaurado: true }) },
            })
            return { status: 200, cuerpo: { ok: true, dia_pago_restaurado: diaRestaurado, dia_pago_no_restaurado: diaNoRestaurado } }
        })
        if (resultado.status === 404) return res.status(404).json({ error: 'No encontramos ese pago.' })
        res.status(resultado.status).json(resultado.cuerpo)
    } catch (err) {
        if (err.code === DEADLOCK || err.code === SERIALIZACION) return res.status(409).json(OCUPADA)
        registrarError('POST /admin/cuentas/:id/pagos/:pagoId/anular', err)
        res.status(500).json({ error: 'No se pudo anular el pago.' })
    }
}
