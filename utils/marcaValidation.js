import { CODIGOS_PAIS } from './paises.js'

// Pendiente confirmar con el abogado el significado de cada letra.
export const SIGNOS = {
  M: 'Mixta',
  D: 'Denominativa',
  F: 'Figurativa',
}

const CLASE_MIN = 1
const CLASE_MAX = 45

function pad(n) {
  return String(n).padStart(2, '0')
}

export function isoDesdePartes(anio, mes, dia) {
  return `${anio}-${pad(mes)}-${pad(dia)}`
}

// Fecha de hoy en formato ISO, en hora local (toISOString usa UTC y
// a la noche podría devolver el día siguiente).
export function hoyISO() {
  const hoy = new Date()
  return isoDesdePartes(hoy.getFullYear(), hoy.getMonth() + 1, hoy.getDate())
}

// Chequea que "aaaa-mm-dd" sea una fecha real: new Date() acepta cosas
// como 2026-02-31 y las corre al 3 de marzo sin avisar.
function esFechaISOValida(valor) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor)
  if (!match) return false
  const [, anio, mes, dia] = match.map(Number)
  const fecha = new Date(anio, mes - 1, dia)
  return fecha.getFullYear() === anio && fecha.getMonth() === mes - 1 && fecha.getDate() === dia
}

// "aaaa-mm-dd" -> "dd/mm/aaaa" (para mostrar)
export function formatFecha(iso) {
  if (!iso) return ''
  const [anio, mes, dia] = iso.slice(0, 10).split('-')
  return `${dia}/${mes}/${anio}`
}

// "dd/mm/aaaa" (también acepta - o . como separador, y ISO) -> "aaaa-mm-dd".
// Si no la reconoce devuelve el texto tal cual, para que la validación lo marque.
export function parseFecha(valor) {
  const texto = String(valor ?? '').trim()
  const dma = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(texto)
  if (dma) return isoDesdePartes(dma[3], dma[2], dma[1])
  return texto
}

// Limpia los datos antes de validar o mandar al backend:
// recorta espacios, pasa a mayúsculas los códigos y convierte la clase a número.
export function normalizarMarca(marca) {
  const texto = (v) => String(v ?? '').trim()
  const clase = texto(marca.clase_niza)

  return {
    fecha_solicitud: texto(marca.fecha_solicitud),
    expediente: texto(marca.expediente),
    clase_niza: clase === '' ? '' : Number(clase),
    denominacion: texto(marca.denominacion),
    signo: texto(marca.signo).toUpperCase(),
    titular: texto(marca.titular),
    pais: texto(marca.pais).toUpperCase(),
  }
}

// Devuelve { campo: mensaje } solo con los campos que tienen error.
// Un objeto vacío significa que la marca es válida.
export function validarMarca(marca) {
  const errores = {}

  if (!marca.fecha_solicitud) {
    errores.fecha_solicitud = 'Ingresá la fecha de solicitud.'
  } else if (!esFechaISOValida(marca.fecha_solicitud)) {
    errores.fecha_solicitud = 'Fecha inválida (usá dd/mm/aaaa).'
  } else if (marca.fecha_solicitud > hoyISO()) {
    errores.fecha_solicitud = 'La fecha no puede ser futura.'
  }

  if (!marca.expediente) {
    errores.expediente = 'Ingresá el número de expediente.'
  } else if (!/^\d+$/.test(marca.expediente)) {
    errores.expediente = 'El expediente solo puede tener números.'
  }

  if (marca.clase_niza === '') {
    errores.clase_niza = 'Ingresá la clase Niza.'
  } else if (
    !Number.isInteger(marca.clase_niza) ||
    marca.clase_niza < CLASE_MIN ||
    marca.clase_niza > CLASE_MAX
  ) {
    errores.clase_niza = `La clase debe ser un número entre ${CLASE_MIN} y ${CLASE_MAX}.`
  }

  if (!SIGNOS[marca.signo]) {
    errores.signo = 'El signo debe ser M, D o F.'
  }

  // Una marca figurativa puede ser solo un logo, sin texto.
  if (!marca.denominacion && marca.signo !== 'F') {
    errores.denominacion = 'Ingresá la denominación.'
  }

  if (!marca.titular) {
    errores.titular = 'Ingresá el titular.'
  }

  if (!CODIGOS_PAIS.includes(marca.pais)) {
    errores.pais = 'País inválido (usá el código de 2 letras, ej.: PY).'
  }

  return errores
}
