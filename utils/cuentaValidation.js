// Validación de los datos administrativos de una cuenta (panel comercial,
// etapa 3; tabla cuentas_facturacion, sql/016).
//
// IMPORTANTE: es copia de nubio/panel/validacionCuenta.js (como pasa con
// marcaValidation.js y authValidation.js). Si cambia una regla, cambiarla en
// los dos. La que manda es esta: el panel valida para avisar antes, el servidor
// valida siempre.
//
// normalizarCuenta deja los datos listos (recortados, teléfono en formato
// internacional, monto sin puntos) y validarCuenta devuelve { campo: mensaje }.
import { normalizarEmail, validarEmail, validarNombre } from './authValidation.js'

export const MEDIOS_PAGO = ['transferencia', 'efectivo', 'tarjeta', 'debito_automatico', 'otro']
export const MODALIDADES = ['mensual', 'anual', 'automatica_mensual']
export const MONTO_MAXIMO = 100_000_000 // Gs.: un tope que no se va a tocar, contra errores de tipeo
export const LARGO_MAXIMO_RAZON_SOCIAL = 200
export const LARGO_MAXIMO_NOTA = 2000

const CARACTERES_INVISIBLES = /[\p{Cc}\p{Cf}]/u
const texto = (v) => (typeof v === 'string' ? v.trim() : '')

// Teléfono en formato internacional (E.164): "+595981123456". Acepta como lo
// escribe la gente en Paraguay: "0981 123 456", "(0981) 123-456", "595981…",
// y el celular sin el 0 ("981 123 456": 9 cifras que empiezan con 9; Molly).
export function normalizarTelefono(valor) {
    let t = texto(valor).replace(/[\s().-]/g, '')
    if (!t) return ''
    if (t.startsWith('00')) t = `+${t.slice(2)}`
    else if (t.startsWith('0')) t = `+595${t.slice(1)}`
    else if (t.startsWith('595')) t = `+${t}`
    else if (/^9\d{8}$/.test(t)) t = `+595${t}`
    return t
}

// Guaraníes sin decimales: "150.000", "150000" o 150000 → 150000
export function normalizarMonto(valor) {
    if (typeof valor === 'number') return valor
    const t = texto(valor).replace(/[.\s]/g, '').replace(/^Gs/i, '')
    return /^\d+$/.test(t) ? Number(t) : NaN
}

export function normalizarCuenta(entrada = {}) {
    return {
        nombre_completo: texto(entrada.nombre_completo),
        email: normalizarEmail(entrada.email),
        telefono: normalizarTelefono(entrada.telefono),
        ruc: texto(entrada.ruc).replace(/\s/g, ''),
        razon_social: texto(entrada.razon_social),
        medio_pago: texto(entrada.medio_pago),
        modalidad: texto(entrada.modalidad),
        fecha_ingreso: texto(entrada.fecha_ingreso),
        dia_pago: Number(entrada.dia_pago),
        monto_mensual: normalizarMonto(entrada.monto_mensual),
    }
}

function fechaValida(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false
    const d = new Date(`${iso}T00:00:00Z`)
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso
}

// `conEmail`: el correo solo se valida en el alta (después no se cambia: es la
// identidad con la que entra el cliente).
export function validarCuenta(c, { conEmail = true } = {}) {
    const errores = {}
    // Mensajes propios (no los de authValidation, que le hablan al cliente:
    // "tu nombre"); de ahí solo se toma si hay error.
    if (!c.nombre_completo) errores.nombre_completo = 'Ingresá el nombre completo.'
    else if (validarNombre(c.nombre_completo)) errores.nombre_completo = validarNombre(c.nombre_completo)
    if (conEmail) {
        if (!c.email) errores.email = 'Ingresá el correo.'
        else if (validarEmail(c.email)) errores.email = 'Revisá el correo: por ejemplo, ana@estudio.com.'
    }
    if (!c.telefono) errores.telefono = 'Ingresá el teléfono.'
    else if (!/^\+\d{8,15}$/.test(c.telefono)) errores.telefono = 'Revisá el teléfono: por ejemplo, 0981 123 456.'
    if (c.ruc && !/^\d{1,9}-\d$/.test(c.ruc)) errores.ruc = 'El RUC va con el dígito verificador: por ejemplo, 80012345-6.'
    if (c.razon_social) {
        if (c.razon_social.length > LARGO_MAXIMO_RAZON_SOCIAL) errores.razon_social = `La razón social puede tener hasta ${LARGO_MAXIMO_RAZON_SOCIAL} caracteres.`
        else if (CARACTERES_INVISIBLES.test(c.razon_social)) errores.razon_social = 'La razón social tiene caracteres que no se pueden usar.'
    }
    if (!MEDIOS_PAGO.includes(c.medio_pago)) errores.medio_pago = 'Elegí el medio de pago.'
    if (!MODALIDADES.includes(c.modalidad)) errores.modalidad = 'Elegí la modalidad.'
    if (!fechaValida(c.fecha_ingreso)) errores.fecha_ingreso = 'Ingresá la fecha de ingreso.'
    if (!Number.isInteger(c.dia_pago) || c.dia_pago < 1 || c.dia_pago > 31) errores.dia_pago = 'El día de pago va del 1 al 31.'
    if (!Number.isInteger(c.monto_mensual) || c.monto_mensual <= 0) errores.monto_mensual = 'Ingresá el monto mensual en guaraníes, solo con números: por ejemplo, 150000 o 150.000.'
    else if (c.monto_mensual > MONTO_MAXIMO) errores.monto_mensual = 'Revisá el monto: parece demasiado alto.'
    return errores
}

export function validarNota(valor) {
    const t = texto(valor)
    if (!t) return 'Escribí la nota.'
    if (t.length > LARGO_MAXIMO_NOTA) return `La nota puede tener hasta ${LARGO_MAXIMO_NOTA} caracteres.`
    // Saltos de línea sí (es un texto largo); el resto de los de control, no
    // eslint-disable-next-line no-control-regex -- a propósito: son los que se rechazan
    if (/[\p{Cf}]|[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(t)) return 'La nota tiene caracteres que no se pueden usar.'
    return null
}
