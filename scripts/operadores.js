// Operadores del panel comercial (etapa 2). Solo el desarrollador los maneja,
// con estos comandos; no hay forma de crearlos desde el panel ni desde la API.
//
//   npm run operadores -- listar
//   npm run operadores -- crear --nombre="Ana Pérez" --email=ana@estudio.com
//   npm run operadores -- resetear --email=ana@estudio.com   (olvidó la contraseña, perdió el celular o quedó bloqueado)
//   npm run operadores -- desactivar --email=ana@estudio.com (deja el panel; no se borra)
//
// crear y resetear muestran un link de activación (un solo uso, 72 h): mandalo
// SOLO a esa persona, por un canal suyo. Con el link elige su contraseña y
// configura el código de 2 pasos en el celular. Nadie más los conoce.
//
// Necesita, además de DATABASE_URL: ADMIN_CIFRADO_KEY (cifra el secreto del
// código) y ADMIN_FRONTEND_URL (la dirección del panel, para armar el link).
// Contra producción: las tres solo para este comando, desde
// c:\dev\nubio-api-produccion, y después Remove-Item Env:DATABASE_URL,
// Env:ADMIN_CIFRADO_KEY y Env:ADMIN_FRONTEND_URL.
import 'dotenv/config'
import { crearDb } from '../db.js'
import { normalizarEmail, validarEmail, validarNombre } from '../utils/authValidation.js'
import { crearOperador, resetearOperador, desactivarOperador, ipsQueAbrieronLink } from '../services/operadores.js'

const [comando] = process.argv.slice(2)
const arg = (nombre) => process.argv.find((a) => a.startsWith(`--${nombre}=`))?.split('=').slice(1).join('=')

async function porEmail(db) {
    const email = normalizarEmail(arg('email'))
    if (!email || validarEmail(email)) throw new Error('Falta --email=... válido.')
    const op = await db('operadores').where({ email }).first('id', 'nombre', 'email', 'activo')
    if (!op) throw new Error(`No hay ningún operador con el correo ${email}.`)
    return op
}

async function main() {
    const db = crearDb()
    console.log(`Base: ${new URL(process.env.DATABASE_URL).hostname}`)
    try {
        if (comando === 'listar') {
            const filas = await db('operadores').orderBy('id').select('id', 'nombre', 'email', 'activo', 'activado_at', 'bloqueado_at')
            if (filas.length === 0) console.log('Todavía no hay operadores.')
            for (const o of filas) {
                const estado = !o.activo ? 'desactivado'
                    : o.bloqueado_at ? 'BLOQUEADO por códigos incorrectos (destrabar con resetear)'
                    : o.activado_at ? 'activo' : 'sin activar (link pendiente)'
                // Si el link pendiente se abrió desde más de una IP, alguien más
                // lo vio: mejor resetear y mandar uno nuevo (Case, M2).
                const ips = o.activo && !o.activado_at ? await ipsQueAbrieronLink(db, o.id) : null
                const aviso = ips > 1 ? `  ATENCIÓN: el link se abrió desde ${ips} lugares distintos` : ''
                console.log(`${o.id}  ${o.nombre}  <${o.email}>  ${estado}${aviso}`)
            }
        } else if (comando === 'crear') {
            const nombre = String(arg('nombre') ?? '').trim()
            const email = normalizarEmail(arg('email'))
            const error = validarNombre(nombre) || (email ? validarEmail(email) : 'Falta --email=...')
            if (error) throw new Error(error)
            const { id, link } = await crearOperador(db, { nombre, email })
            console.log(`Operador ${id} creado: ${nombre} <${email}>.`)
            console.log('Link de activación (un solo uso, vence en 72 h). Mandalo SOLO a esa persona:')
            console.log(link)
        } else if (comando === 'resetear') {
            const op = await porEmail(db)
            if (!op.activo) throw new Error('Está desactivado. Si tiene que volver, avisá al desarrollador (hoy no hay comando para reactivar).')
            const link = await resetearOperador(db, op.id)
            console.log(`${op.nombre}: contraseña y código de 2 pasos borrados, sesiones cerradas.`)
            console.log('Link nuevo de activación (un solo uso, 72 h). Mandalo SOLO a esa persona:')
            console.log(link)
        } else if (comando === 'desactivar') {
            const op = await porEmail(db)
            const hecho = await desactivarOperador(db, op.id)
            console.log(hecho ? `${op.nombre} desactivado: ya no puede entrar al panel y sus sesiones se cerraron.` : 'Ya estaba desactivado.')
        } else {
            console.error('Uso: npm run operadores -- listar | crear --nombre=... --email=... | resetear --email=... | desactivar --email=...')
            process.exitCode = 1
        }
    } catch (err) {
        // Un correo repetido llega como error de Postgres: mensaje claro
        console.error(err.code === '23505' ? 'Ya hay un operador con ese correo.' : err.message)
        process.exitCode = 1
    } finally {
        await db.destroy()
    }
}

main()
