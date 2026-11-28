// Auditoría del panel comercial (etapa 2; tabla auditoria_admin, sql/015).
// Quién hizo qué, cuándo y sobre qué cuenta. Se inserta en la MISMA
// transacción que la acción (revisión de Case, M3): si la acción se deshace,
// el registro también, y no hay acción sin registro.
//
// Acciones: operador_creado, operador_activado, operador_reseteado,
// operador_desactivado, login, logout, codigo_fallido, bloqueo_codigo,
// activacion_vista, cuenta_suspendida, cuenta_reactivada; etapa 3: cuenta_creada,
// datos_editados, datos_completados, nota_agregada, link_generado,
// activacion_cliente_vista, cliente_activado, cliente_cambio_password.
//
// `detalle`: sin datos personales. Ids y nombres de campos, nunca valores
// (ni teléfonos, ni montos con nombre, ni notas). Lo que corre un script lleva
// además `equipo` (el nombre de la PC desde donde se corrió), porque no tiene
// operador ni IP (Case, M3).
// Además va al registro de eventos (utils/eventos.js), para verlo en vivo en
// los logs de Render.
import { hostname } from 'node:os'
import { registrarEvento } from '../utils/eventos.js'

export const ORIGEN = { panel: 'panel', script: 'script' }

export async function registrarAuditoria(dbOTrx, { operadorId = null, origen, accion, cuentaId = null, detalle = {}, ip = null }) {
    const completo = origen === ORIGEN.script ? { ...detalle, equipo: hostname() } : detalle
    await dbOTrx('auditoria_admin').insert({
        operador_id: operadorId,
        origen,
        accion,
        cuenta_id: cuentaId,
        detalle: JSON.stringify(completo),
        ip,
    })
    registrarEvento(`admin_${accion}`, { operador: operadorId ?? undefined, origen, cuenta_id: cuentaId ?? undefined, ip: ip ?? undefined, ...completo })
}
