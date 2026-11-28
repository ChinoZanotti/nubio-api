// Aviso de cuota de la app de clientes (panel comercial, etapa 4).
// GET /cuenta/cuota (con la sesión del cliente): { estado, pagado_hasta, dias }
// de la cuenta del token (req.cuentaId) y nada más: sin montos ni pagos.
import { registrarError } from '../utils/log.js'
import { cuotaDelCliente } from '../services/cuotas.js'

export async function handleCuotaCliente(req, res, db) {
    try {
        // Sin caché: cambia cuando se registra un pago (Case, etapa 4)
        res.set('Cache-Control', 'no-store')
        res.json(await cuotaDelCliente(db, req.cuentaId))
    } catch (err) {
        registrarError('GET /cuenta/cuota', err)
        res.status(500).json({ error: 'No se pudo obtener el estado de la cuota.' })
    }
}
