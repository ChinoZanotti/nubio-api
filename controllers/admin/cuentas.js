// Cuentas en el panel comercial (etapa 3). Rutas /admin/cuentas, con sesión
// de operador (routes/admin.js).
//
// Lo que el panel ve de cada cuenta: el estado, los datos administrativos
// (cuentas_facturacion), el correo del usuario y si ya activó su acceso, las
// notas y la actividad. NUNCA marcas, alertas ni nada de la cartera (revisión
// de Case de la idea, A2).
//
// Toda acción queda en auditoria_admin en la misma transacción, con los
// NOMBRES de los campos que cambiaron, nunca los valores.
import { parseId } from '../../utils/id.js'
import { registrarError } from '../../utils/log.js'
import { normalizarCuenta, validarCuenta, validarNota } from '../../utils/cuentaValidation.js'
import { registrarAuditoria, ORIGEN } from '../../services/auditoria.js'
import { crearActivacionUsuario } from '../../services/activacionUsuario.js'
import { suspenderCuenta, reactivarCuenta } from '../../services/cuentas.js'
import { encolarAlertasParaMarcas } from '../../services/alertas.js'

const UNIQUE_VIOLATION = '23505'
const CHECK_VIOLATION = '23514'
const CAMPOS_FACTURACION = ['nombre_completo', 'telefono', 'ruc', 'razon_social', 'medio_pago', 'modalidad', 'fecha_ingreso', 'dia_pago', 'monto_mensual']
const NO_ENCONTRADA = { error: 'No encontramos esa cuenta.' }
const CUENTA_MODIFICADA = {
    error: 'Otra persona cambió esta cuenta mientras la editabas. Para no pisar sus cambios, no guardamos los tuyos: volvé a la ficha para ver los datos actuales.',
    codigo: 'cuenta_modificada',
}
const quien = (req) => ({ origen: ORIGEN.panel, operadorId: req.operadorId, ip: req.ip })

// Fila de facturación desde los datos normalizados ('' → NULL)
const aFila = (c) => ({ ...Object.fromEntries(CAMPOS_FACTURACION.map((k) => [k, c[k]])), ruc: c.ruc || null, razon_social: c.razon_social || null })
// El nombre de la cuenta: la razón social si hay, si no el nombre de la persona
const nombreDeCuenta = (c) => c.razon_social || c.nombre_completo

function errorDeValidacion(res, errores) {
    return res.status(400).json({ error: Object.values(errores)[0], errores })
}

// El último link sin usar ni reemplazar de un usuario (puede estar vencido:
// la pantalla distingue "falta crear la contraseña" de "el link venció").
const ULTIMO_LINK = 'SELECT id, vence_at FROM activaciones_usuario WHERE user_id = u.id AND usada_at IS NULL AND revocada_at IS NULL ORDER BY id DESC LIMIT 1'

// GET /admin/cuentas: todas (son cientos, no miles): la pantalla filtra y
// ordena. Columnas explícitas.
export async function handleListarCuentas(req, res, db) {
    try {
        const filas = await db('cuentas as c')
            .leftJoin('cuentas_facturacion as f', 'f.cuenta_id', 'c.id')
            // El usuario de la cuenta (hoy uno por cuenta): el más antiguo
            .joinRaw('LEFT JOIN LATERAL (SELECT id, email FROM users WHERE cuenta_id = c.id ORDER BY id LIMIT 1) AS u ON true')
            .joinRaw(`LEFT JOIN LATERAL (${ULTIMO_LINK}) AS al ON true`)
            .select(
                'c.id', 'c.nombre', 'c.estado', 'c.estado_desde', 'c.plan', 'c.created_at',
                'f.nombre_completo', 'f.telefono', 'f.modalidad', 'f.medio_pago', 'f.monto_mensual', 'f.fecha_ingreso', 'f.dia_pago',
                'u.email', 'al.vence_at as link_vence',
                db.raw('EXISTS (SELECT 1 FROM login l WHERE l.email = u.email) AS activado'),
            )
            .orderBy('c.nombre')
            .limit(5000)
        res.json(filas)
    } catch (err) {
        registrarError('GET /admin/cuentas', err)
        res.status(500).json({ error: 'No se pudieron obtener las cuentas.' })
    }
}

// GET /admin/cuentas/:id: la ficha.
export async function handleVerCuenta(req, res, db) {
    const id = parseId(req.params.id)
    if (!id) return res.status(400).json(NO_ENCONTRADA)
    try {
        const cuenta = await db('cuentas').where({ id }).first('id', 'nombre', 'estado', 'estado_desde', 'plan', 'created_at')
        if (!cuenta) return res.status(404).json(NO_ENCONTRADA)
        const facturacion = await db('cuentas_facturacion').where({ cuenta_id: id })
            .first(...CAMPOS_FACTURACION, 'version', 'updated_at')
        const usuario = await db('users').where({ cuenta_id: id }).orderBy('id').first('id', 'email')
        const activado = usuario ? Boolean(await db('login').where({ email: usuario.email }).first('id')) : false
        // El último link sin usar ni reemplazar (puede estar vencido)
        const linkPendiente = usuario ? await db('activaciones_usuario').where({ user_id: usuario.id }).whereNull('usada_at')
            .whereNull('revocada_at').orderBy('id', 'desc').first('id', 'vence_at') : null
        // Desde cuántos lugares (IP) se abrió ese link: más de uno puede ser
        // un link reenviado o mandado al chat equivocado (Case, B4)
        const linkIps = linkPendiente
            ? Number((await db('auditoria_admin').where({ accion: 'activacion_cliente_vista', cuenta_id: id })
                .whereRaw("detalle->>'activacion' = ?", [String(linkPendiente.id)]).countDistinct('ip as n').first()).n)
            : 0
        const notas = await db('notas_cuenta as n').join('operadores as o', 'o.id', 'n.operador_id')
            .where('n.cuenta_id', id).orderBy('n.created_at', 'desc').limit(200)
            .select('n.id', 'n.texto', 'n.created_at', 'o.nombre as autor')
        const actividad = await db('auditoria_admin as a').leftJoin('operadores as o', 'o.id', 'a.operador_id')
            .where('a.cuenta_id', id).orderBy('a.created_at', 'desc').limit(50)
            .select('a.id', 'a.accion', 'a.detalle', 'a.origen', 'a.created_at', 'o.nombre as autor')
        res.json({
            ...cuenta,
            facturacion: facturacion ?? null,
            usuario: usuario ? { email: usuario.email, activado, link_vence: linkPendiente?.vence_at ?? null, link_ips: linkIps } : null,
            notas,
            actividad,
        })
    } catch (err) {
        registrarError('GET /admin/cuentas/:id', err)
        res.status(500).json({ error: 'No se pudo obtener la cuenta.' })
    }
}

// POST /admin/cuentas: alta. Crea cuenta, usuario (sin contraseña: no puede
// entrar hasta activar), datos administrativos, la nota inicial (opcional) y
// el link de activación, en una transacción: o queda todo o nada (Case, B5).
// Devuelve el link UNA vez: no se guarda en claro.
export async function handleCrearCuenta(req, res, db) {
    const c = normalizarCuenta(req.body)
    const errores = validarCuenta(c)
    const nota = typeof req.body?.nota === 'string' ? req.body.nota.trim() : ''
    if (nota) {
        const errorNota = validarNota(nota)
        if (errorNota) errores.nota = errorNota
    }
    if (Object.keys(errores).length) return errorDeValidacion(res, errores)
    try {
        const resultado = await db.transaction(async (trx) => {
            // El correo es la identidad para entrar: no puede repetirse, ni
            // con otro usuario ni con un login suelto.
            const existe = await trx('users').where({ email: c.email }).first('id')
                ?? await trx('login').where({ email: c.email }).first('id')
            if (existe) return { duplicado: true }
            const [cuenta] = await trx('cuentas').insert({ nombre: nombreDeCuenta(c) }).returning('id')
            const [usuario] = await trx('users').insert({ email: c.email, name: c.nombre_completo, joined: new Date(), cuenta_id: cuenta.id }).returning('id')
            await trx('cuentas_facturacion').insert({ cuenta_id: cuenta.id, ...aFila(c), updated_by: req.operadorId })
            if (nota) await trx('notas_cuenta').insert({ cuenta_id: cuenta.id, operador_id: req.operadorId, texto: nota })
            const { link, vence } = await crearActivacionUsuario(trx, usuario.id, req.operadorId)
            await registrarAuditoria(trx, { ...quien(req), accion: 'cuenta_creada', cuentaId: cuenta.id, detalle: { campos: CAMPOS_FACTURACION.filter((k) => c[k]), nota: Boolean(nota) } })
            return { id: cuenta.id, link, vence }
        })
        if (resultado.duplicado) {
            const errores = { email: 'Ya hay una cuenta con ese correo.' }
            return res.status(409).json({ error: errores.email, errores })
        }
        res.status(201).json(resultado)
    } catch (err) {
        if (err.code === UNIQUE_VIOLATION) {
            const errores = { email: 'Ya hay una cuenta con ese correo.' }
            return res.status(409).json({ error: errores.email, errores })
        }
        if (err.code === CHECK_VIOLATION) return res.status(400).json({ error: 'Algún dato de la cuenta no es válido.' })
        registrarError('POST /admin/cuentas', err)
        res.status(500).json({ error: 'No se pudo crear la cuenta.' })
    }
}

// PATCH /admin/cuentas/:id { ...datos, version }: editar los datos
// administrativos (no el correo). Con la versión leída: si otro operador
// guardó antes, 409 y no se pisa lo suyo. version 0 = la cuenta no tenía datos
// administrativos (las creadas antes del panel): se completan.
export async function handleEditarCuenta(req, res, db) {
    const id = parseId(req.params.id)
    if (!id) return res.status(400).json(NO_ENCONTRADA)
    const version = Number(req.body?.version)
    if (!Number.isInteger(version) || version < 0) return res.status(400).json({ error: 'Falta la versión. Volvé a abrir la cuenta.' })
    const c = normalizarCuenta(req.body)
    const errores = validarCuenta(c, { conEmail: false })
    if (Object.keys(errores).length) return errorDeValidacion(res, errores)
    try {
        const resultado = await db.transaction(async (trx) => {
            const cuenta = await trx('cuentas').where({ id }).first('id')
            if (!cuenta) return { status: 404 }
            const anterior = await trx('cuentas_facturacion').where({ cuenta_id: id }).first(...CAMPOS_FACTURACION, 'version')
            if (!anterior && version !== 0) return { status: 409 }
            if (anterior && anterior.version !== version) return { status: 409 }
            const fila = aFila(c)
            if (anterior) {
                const cambiadas = await trx('cuentas_facturacion').where({ cuenta_id: id, version })
                    .update({ ...fila, version: trx.raw('version + 1'), updated_at: trx.fn.now(), updated_by: req.operadorId })
                if (!cambiadas) return { status: 409 }
            } else {
                await trx('cuentas_facturacion').insert({ cuenta_id: id, ...fila, updated_by: req.operadorId })
            }
            await trx('cuentas').where({ id }).update({ nombre: nombreDeCuenta(c) })
            const campos = CAMPOS_FACTURACION.filter((k) => String(anterior?.[k] ?? '') !== String(fila[k] ?? ''))
            await registrarAuditoria(trx, { ...quien(req), accion: anterior ? 'datos_editados' : 'datos_completados', cuentaId: id, detalle: { campos } })
            return { status: 200 }
        })
        if (resultado.status === 404) return res.status(404).json(NO_ENCONTRADA)
        if (resultado.status === 409) {
            return res.status(409).json(CUENTA_MODIFICADA)
        }
        res.json({ ok: true })
    } catch (err) {
        // Dos operadores completando a la vez una cuenta de antes del panel: el
        // segundo INSERT choca con la clave (Case, B3). Es el mismo conflicto.
        if (err.code === UNIQUE_VIOLATION) return res.status(409).json(CUENTA_MODIFICADA)
        if (err.code === CHECK_VIOLATION) return res.status(400).json({ error: 'Algún dato de la cuenta no es válido.' })
        registrarError('PATCH /admin/cuentas/:id', err)
        res.status(500).json({ error: 'No se pudieron guardar los datos.' })
    }
}

// POST /admin/cuentas/:id/notas { texto }
export async function handleAgregarNota(req, res, db) {
    const id = parseId(req.params.id)
    if (!id) return res.status(400).json(NO_ENCONTRADA)
    const error = validarNota(req.body?.texto)
    if (error) return res.status(400).json({ error, errores: { texto: error } })
    try {
        const nota = await db.transaction(async (trx) => {
            if (!(await trx('cuentas').where({ id }).first('id'))) return null
            const [fila] = await trx('notas_cuenta').insert({ cuenta_id: id, operador_id: req.operadorId, texto: req.body.texto.trim() })
                .returning(['id', 'texto', 'created_at'])
            await registrarAuditoria(trx, { ...quien(req), accion: 'nota_agregada', cuentaId: id })
            return fila
        })
        if (!nota) return res.status(404).json(NO_ENCONTRADA)
        res.status(201).json({ ...nota, autor: req.operador.nombre })
    } catch (err) {
        registrarError('POST /admin/cuentas/:id/notas', err)
        res.status(500).json({ error: 'No se pudo guardar la nota.' })
    }
}

// POST /admin/cuentas/:id/suspender y /reactivar. Los decide siempre una
// persona (Carlos, noviembre 2026).
export async function handleSuspender(req, res, db) {
    const id = parseId(req.params.id)
    if (!id) return res.status(400).json(NO_ENCONTRADA)
    try {
        const resultado = await suspenderCuenta(db, id, quien(req))
        if (resultado === 'no_existe') return res.status(404).json(NO_ENCONTRADA)
        res.json({ resultado })
    } catch (err) {
        registrarError('POST /admin/cuentas/:id/suspender', err)
        res.status(500).json({ error: 'No se pudo suspender la cuenta.' })
    }
}

// Al reactivar se generan las alertas que la cuenta se perdió mientras estuvo
// suspendida, contra lo que sigue en plazo. Por la fila del motor y en tandas,
// sin esperar: con una cartera grande tarda minutos. encolarAlertasParaMarcas
// no mira el tope por cuenta a propósito: es una acción deliberada y rara, y si
// no entrara, la cuenta quedaría reactivada sin alertas.
// Una sola puesta al día por cuenta a la vez (Case, M1): la fila del motor es
// una para todos, y suspender y reactivar en bucle la llenaría por horas. Si ya
// hay una en curso, esa misma genera lo que falta (el motor mira el estado
// actual de las marcas). Este proceso es el único que atiende la fila, así que
// alcanza con recordarlo en memoria.
const TANDA_REACTIVACION = 500
const puestasAlDia = new Set()
export async function handleReactivar(req, res, db) {
    const id = parseId(req.params.id)
    if (!id) return res.status(400).json(NO_ENCONTRADA)
    try {
        const { resultado, marcaIds } = await reactivarCuenta(db, id, quien(req))
        if (resultado === 'no_existe') return res.status(404).json(NO_ENCONTRADA)
        if (marcaIds.length && !puestasAlDia.has(id)) {
            puestasAlDia.add(id)
            const tandas = []
            for (let i = 0; i < marcaIds.length; i += TANDA_REACTIVACION) {
                tandas.push(encolarAlertasParaMarcas(db, marcaIds.slice(i, i + TANDA_REACTIVACION), id))
            }
            // encolarAlertasParaMarcas ya registra sus errores y nunca rechaza
            Promise.allSettled(tandas).finally(() => puestasAlDia.delete(id))
        }
        // Sin la cantidad de marcas: el tamaño de la cartera de un cliente no
        // es dato del panel (Case, I1). Queda en la auditoría.
        res.json({ resultado })
    } catch (err) {
        registrarError('POST /admin/cuentas/:id/reactivar', err)
        res.status(500).json({ error: 'No se pudo reactivar la cuenta.' })
    }
}

// POST /admin/cuentas/:id/link: un link nuevo para que el cliente cree (o
// cambie) su contraseña. Invalida el anterior sin usar. La contraseña actual
// sigue valiendo hasta que se use el link.
export async function handleNuevoLink(req, res, db) {
    const id = parseId(req.params.id)
    if (!id) return res.status(400).json(NO_ENCONTRADA)
    try {
        const resultado = await db.transaction(async (trx) => {
            const usuario = await trx('users').where({ cuenta_id: id }).orderBy('id').first('id')
            if (!usuario) return null
            const link = await crearActivacionUsuario(trx, usuario.id, req.operadorId)
            await registrarAuditoria(trx, { ...quien(req), accion: 'link_generado', cuentaId: id })
            return link
        })
        if (!resultado) return res.status(404).json(NO_ENCONTRADA)
        res.json(resultado)
    } catch (err) {
        registrarError('POST /admin/cuentas/:id/link', err)
        res.status(500).json({ error: 'No se pudo generar el link.' })
    }
}
