// Borrar una cuenta y todo lo suyo (cancelaciones, cuentas de prueba). No se
// hace desde el panel (decisión de noviembre 2026): lo hace el desarrollador
// con `npm run borrar-cuenta` (scripts/borrar-cuenta.js, pasos en
// docs/borrar-cuenta.md).
//
// Qué se borra, en una sola transacción (o todo o nada):
//   alertas de sus marcas → marcas → pagos → notas → datos administrativos →
//   links de activación → login (por correo) → usuarios → la cuenta.
// Qué queda: auditoria_admin (sin clave foránea a propósito: "¿quién dio de
// alta esta cuenta?" tiene que poder contestarse después), pero sin las IPs
// del cliente (Case, M4): las de los operadores sí quedan, son la traza de
// quién hizo qué. Se agrega `cuenta_borrada` con las cantidades, sin datos
// personales.
//
// Resguardos (revisión de Case, 28/11/2026):
// - La cuenta tiene que estar SUSPENDIDA hace más de 2 minutos: un segundo
//   paso deliberado; sus sesiones ya se cortaron (el caché de sesiones del
//   servidor tarda hasta 30 s si se suspendió con un script) y el motor ya no
//   le genera alertas (B2).
// - Quien la borra confirma el nombre y las cantidades que vio: si cambiaron
//   entre la vista previa y el borrado, no se borra nada (M3).
// - Si un usuario de la cuenta cargó marcas que hoy son de OTRA cuenta (se lo
//   movió de cuenta), no se borra nada: en producción, hasta correr sql/013,
//   borrar el usuario se llevaría esas marcas en cascada (M1). Lo mismo si su
//   correo está en otra cuenta (B1).
// - Si la base tiene una clave foránea, o una columna cuenta_id / user_id /
//   marca_id / alerta_id, que este código no conoce (una función nueva), no se
//   borra nada y lo dice: hay que sumarla acá (M2).
// - lock_timeout de 5 s (B3): si otra transacción larga tiene filas de la
//   cuenta, falla entero en vez de quedarse esperando.
import { registrarAuditoria } from './auditoria.js'

// Las claves foráneas que este borrado conoce: tabla.columna→tabla apuntada
export const CLAVES_CONOCIDAS = [
    'users.cuenta_id→cuentas',
    'marcas.cuenta_id→cuentas',
    'marcas.user_id→users',
    'alertas.marca_id→marcas',
    'cuentas_facturacion.cuenta_id→cuentas',
    'notas_cuenta.cuenta_id→cuentas',
    'pagos_cuenta.cuenta_id→cuentas',
    'activaciones_usuario.user_id→users',
]
// Las columnas con nombre de "id de cuenta, usuario, marca o alerta" que este
// borrado conoce. auditoria_admin.cuenta_id no tiene clave foránea a propósito
// y se conserva.
export const COLUMNAS_CONOCIDAS = [
    'users.cuenta_id', 'marcas.cuenta_id', 'marcas.user_id', 'alertas.marca_id',
    'cuentas_facturacion.cuenta_id', 'notas_cuenta.cuenta_id', 'pagos_cuenta.cuenta_id',
    'activaciones_usuario.user_id', 'auditoria_admin.cuenta_id',
]
// Las tablas de la cuenta: una clave foránea nueva que apunte a cualquiera de
// ellas también frena el borrado
const TABLAS_DE_LA_CUENTA = ['cuentas', 'users', 'marcas', 'alertas', 'cuentas_facturacion', 'notas_cuenta', 'pagos_cuenta', 'activaciones_usuario']
const MINUTOS_SUSPENDIDA = 2

// Lo que la base tiene y este borrado no conoce. `claves`: [{ tabla, columna,
// apunta_a }]; `columnas`: [{ tabla, columna }]. El nombre de la tabla lleva el
// esquema adelante si no es public.
export function desconocidas({ claves = [], columnas = [] }) {
    return [
        ...claves.map((f) => `${f.tabla}.${f.columna}→${f.apunta_a}`).filter((c) => !CLAVES_CONOCIDAS.includes(c)),
        ...columnas.map((c) => `${c.tabla}.${c.columna}`).filter((c) => !COLUMNAS_CONOCIDAS.includes(c)),
    ]
}

const conEsquema = (esquema, tabla) => (esquema === 'public' ? tabla : `${esquema}.${tabla}`)

async function loQueTieneLaBase(trx) {
    const { rows: claves } = await trx.raw(`
        SELECT nr.nspname AS esquema, tc.relname AS tabla, a.attname AS columna, tr.relname AS apunta_a
        FROM pg_constraint c
        JOIN pg_class tc ON tc.oid = c.conrelid
        JOIN pg_namespace nr ON nr.oid = tc.relnamespace
        JOIN pg_class tr ON tr.oid = c.confrelid
        JOIN pg_namespace nd ON nd.oid = tr.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.contype = 'f' AND nd.nspname = 'public' AND tr.relname = ANY (?)`, [TABLAS_DE_LA_CUENTA])
    const { rows: columnas } = await trx.raw(`
        SELECT table_schema AS esquema, table_name AS tabla, column_name AS columna
        FROM information_schema.columns
        WHERE column_name IN ('cuenta_id', 'user_id', 'marca_id', 'alerta_id')
          AND table_schema NOT IN ('pg_catalog', 'information_schema')`)
    return {
        claves: claves.map((f) => ({ ...f, tabla: conEsquema(f.esquema, f.tabla) })),
        columnas: columnas.map((c) => ({ ...c, tabla: conEsquema(c.esquema, c.tabla) })),
    }
}

// Qué tiene la cuenta: para la vista previa, para confirmar y para la auditoría.
export async function contenidoDeCuenta(dbOTrx, cuentaId) {
    const cuenta = await dbOTrx('cuentas').where({ id: cuentaId })
        .first('id', 'nombre', 'estado', dbOTrx.raw('extract(epoch FROM now() - estado_desde) / 60 AS minutos_en_estado'))
    if (!cuenta) return null
    const usuarios = await dbOTrx('users').where({ cuenta_id: cuentaId }).select('id', 'email')
    const ids = usuarios.map((u) => u.id)
    const contar = async (consulta) => Number((await consulta.count('* as n').first()).n)
    return {
        cuenta: { ...cuenta, minutos_en_estado: Number(cuenta.minutos_en_estado) },
        usuarios,
        cantidades: {
            usuarios: usuarios.length,
            marcas: await contar(dbOTrx('marcas').where({ cuenta_id: cuentaId })),
            alertas: await contar(dbOTrx('alertas').whereIn('marca_id', dbOTrx('marcas').where({ cuenta_id: cuentaId }).select('id'))),
            pagos: await contar(dbOTrx('pagos_cuenta').where({ cuenta_id: cuentaId })),
            notas: await contar(dbOTrx('notas_cuenta').where({ cuenta_id: cuentaId })),
            links: ids.length ? await contar(dbOTrx('activaciones_usuario').whereIn('user_id', ids)) : 0,
        },
        // Lo que este borrado tocaría de OTRA cuenta (M1, B1): tiene que ser 0
        ajenas: {
            marcas: ids.length ? await contar(dbOTrx('marcas').whereIn('user_id', ids).whereNot({ cuenta_id: cuentaId })) : 0,
            correos: usuarios.length ? await contar(dbOTrx('users').whereIn('email', usuarios.map((u) => u.email)).whereNot({ cuenta_id: cuentaId })) : 0,
        },
    }
}

const mismasCantidades = (a, b) => Object.keys(a).length === Object.keys(b ?? {}).length && Object.keys(a).every((k) => a[k] === b[k])

// Borra la cuenta. `confirmado`: { nombre, cantidades } que vio y confirmó
// quien la borra. `quien`: { origen, ... } para la auditoría. Devuelve
// { resultado, ... }; resultado es 'borrada', 'no_existe', 'no_suspendida',
// 'suspendida_hace_poco', 'nombre_distinto', 'cantidades_distintas',
// 'toca_otra_cuenta' o 'tablas_desconocidas' (con `claves`).
export async function borrarCuenta(db, cuentaId, confirmado, quien) {
    return db.transaction(async (trx) => {
        await trx.raw("SET LOCAL lock_timeout = '5s'")
        const faltan = desconocidas(await loQueTieneLaBase(trx))
        if (faltan.length) return { resultado: 'tablas_desconocidas', claves: faltan }

        // Bloquea la cuenta: nadie la reactiva ni le registra un pago mientras tanto
        if (!(await trx('cuentas').where({ id: cuentaId }).forUpdate().first('id'))) return { resultado: 'no_existe' }
        const { cuenta, usuarios, cantidades, ajenas } = await contenidoDeCuenta(trx, cuentaId)
        if (cuenta.estado !== 'suspendida') return { resultado: 'no_suspendida' }
        if (cuenta.minutos_en_estado < MINUTOS_SUSPENDIDA) return { resultado: 'suspendida_hace_poco' }
        if (confirmado?.nombre !== cuenta.nombre) return { resultado: 'nombre_distinto' }
        if (!mismasCantidades(cantidades, confirmado?.cantidades)) return { resultado: 'cantidades_distintas', cantidades }
        if (ajenas.marcas || ajenas.correos) return { resultado: 'toca_otra_cuenta', ajenas }

        const ids = usuarios.map((u) => u.id)
        const emails = usuarios.map((u) => u.email)
        const marcas = trx('marcas').where({ cuenta_id: cuentaId }).select('id')
        await trx('alertas').whereIn('marca_id', marcas).del()
        await trx('marcas').where({ cuenta_id: cuentaId }).del()
        await trx('pagos_cuenta').where({ cuenta_id: cuentaId }).del()
        await trx('notas_cuenta').where({ cuenta_id: cuentaId }).del()
        await trx('cuentas_facturacion').where({ cuenta_id: cuentaId }).del()
        if (ids.length) {
            await trx('activaciones_usuario').whereIn('user_id', ids).del()
            await trx('login').whereIn('email', emails).del()
            await trx('users').whereIn('id', ids).del()
        }
        await trx('cuentas').where({ id: cuentaId }).del()
        // Las IPs del cliente en la auditoría (las filas sin operador): son
        // dato personal de alguien que ya no está (Case, M4)
        await trx('auditoria_admin').where({ cuenta_id: cuentaId }).whereNull('operador_id').whereNotNull('ip').update({ ip: null })
        await registrarAuditoria(trx, { ...quien, accion: 'cuenta_borrada', cuentaId, detalle: cantidades })
        return { resultado: 'borrada', cantidades }
    })
}
