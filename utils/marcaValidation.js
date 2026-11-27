import { CODIGOS_PAIS } from './paises.js'

// Tipos de signo, con la letra que usa DINAPI en los boletines.
export const SIGNOS = {
  M: 'Mixta',
  D: 'Denominativa',
  F: 'Figurativa',
  T: 'Tridimensional',
  S: 'Sonora',
}

// Signos que pueden no tener texto: un logo, una forma, un sonido.
// Para el resto la denominación es obligatoria.
export const SIGNOS_SIN_TEXTO = ['F', 'T', 'S']

// Topes de largo. Los textos más largos de los boletines DINAPI miden 181
// (denominación) y 145 (titular): hay margen de sobra para datos reales.
// Sin tope, un texto enorme hace que el motor de similitud (que compara cada
// marca contra miles del boletín, con costo largo × largo) congele el servidor.
// Los mismos números están como CHECK en la base (sql/005_largo_maximo_marcas.sql).
export const LARGO_MAXIMO_DENOMINACION = 300
export const LARGO_MAXIMO_TITULAR = 500
// Los expedientes reales tienen 7 a 10 dígitos. Sin tope, uno de 100.000
// dígitos supera el tamaño máximo del índice UNIQUE de Postgres y hace fallar
// la importación entera. CHECK en sql/007_largo_maximo_expediente.sql.
export const LARGO_MAXIMO_EXPEDIENTE = 20
// Datos del registro (sql/010_marcas_registro.sql), todos opcionales: una
// marca en trámite todavía no tiene registro. El estado es texto libre, como
// lo escribe DINAPI ("Concedida", "En Examen de Fondo"...): son decenas y
// cambian, una lista cerrada se desactualizaría. El más largo visto mide 62.
// El número de registro, como el expediente: solo dígitos.
export const LARGO_MAXIMO_ESTADO = 100
export const LARGO_MAXIMO_REGISTRO = 20

const CLASE_MIN = 1
const CLASE_MAX = 45

function pad(n) {
  return String(n).padStart(2, '0')
}

export function isoDesdePartes(anio, mes, dia) {
  return `${anio}-${pad(mes)}-${pad(dia)}`
}

// Fecha de hoy en formato ISO, en PARAGUAY, no en la zona de la máquina
// (revisión de Case del registro, B3). Render corre en UTC: entre las 21 y las
// 24 de Asunción ya era "mañana" para el servidor, y aceptaba como fecha de
// registro la del día siguiente. Igual que hoy() de utils/plazos.js.
// 'en-CA' da justo el formato aaaa-mm-dd.
export function hoyISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Asuncion' })
}

// Rango razonable de fechas (B4): nada antes de 1900 (no hay marcas vigentes
// de antes) y un vencimiento a lo sumo 30 años adelante (un registro dura 10
// y se renueva). Sin esto, un vencimiento en 9999 alimentaría los avisos de
// renovación con un dato absurdo.
const FECHA_MINIMA = '1900-01-01'
const AÑOS_MAXIMOS_VENCIMIENTO = 30
function vencimientoMaximoISO() {
  const hoy = hoyISO()
  return `${Number(hoy.slice(0, 4)) + AÑOS_MAXIMOS_VENCIMIENTO}${hoy.slice(4)}`
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

// Campos que puede traer una marca. Lo usa camposConTipoInvalido.
const CAMPOS_MARCA = [
  'fecha_solicitud', 'expediente', 'clase_niza', 'denominacion', 'signo', 'titular', 'pais',
  'estado', 'numero_registro', 'fecha_registro', 'fecha_vencimiento',
]

// Cada campo tiene que ser texto, número o vacío (revisión de Case del
// registro, B1). Un objeto o una lista en el JSON se convertía en
// "[object Object]" y se guardaba, o hacía fallar String() con un 500; en una
// importación, una sola fila así tiraba abajo las 1000. Se llama ANTES de
// normalizarMarca. Devuelve { campo: mensaje }, como validarMarca.
export function camposConTipoInvalido(marca) {
  const errores = {}
  if (marca === null || typeof marca !== 'object' || Array.isArray(marca)) {
    return { marca: 'La marca no tiene el formato esperado.' }
  }
  for (const campo of CAMPOS_MARCA) {
    const v = marca[campo]
    if (v !== undefined && v !== null && typeof v !== 'string' && typeof v !== 'number') {
      errores[campo] = 'Valor inválido.'
    }
  }
  return errores
}

// Caracteres de control (tabulación, salto de línea, NUL...). Una celda de
// Excel puede traer saltos de línea, y un NUL hace fallar el INSERT en
// Postgres (B2): se cambian por un espacio en vez de rechazar la marca.
// eslint-disable-next-line no-control-regex -- es justo lo que se busca
const CONTROL = /[\u0000-\u001F\u007F]+/g

// Limpia los datos antes de validar o mandar al backend:
// recorta espacios, pasa a mayúsculas los códigos y convierte la clase a número.
export function normalizarMarca(marca) {
  const texto = (v) => String(v ?? '').replace(CONTROL, ' ').trim()
  const clase = texto(marca.clase_niza)

  return {
    fecha_solicitud: texto(marca.fecha_solicitud),
    expediente: texto(marca.expediente),
    clase_niza: clase === '' ? '' : Number(clase),
    denominacion: texto(marca.denominacion),
    signo: texto(marca.signo).toUpperCase(),
    titular: texto(marca.titular),
    pais: texto(marca.pais).toUpperCase(),
    // Opcionales: '' si no hay dato (el backend lo guarda como NULL)
    // Espacios repetidos a uno: DINAPI a veces deja dobles ("Concedida  ")
    estado: texto(marca.estado).replace(/ {2,}/g, ' '),
    numero_registro: texto(marca.numero_registro),
    fecha_registro: texto(marca.fecha_registro),
    fecha_vencimiento: texto(marca.fecha_vencimiento),
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
  } else if (marca.fecha_solicitud < FECHA_MINIMA) {
    errores.fecha_solicitud = 'La fecha no puede ser anterior a 1900.'
  }

  if (!marca.expediente) {
    errores.expediente = 'Ingresá el número de expediente.'
  } else if (!/^\d+$/.test(marca.expediente)) {
    errores.expediente = 'El expediente solo puede tener números.'
  } else if (marca.expediente.length > LARGO_MAXIMO_EXPEDIENTE) {
    errores.expediente = `El expediente puede tener hasta ${LARGO_MAXIMO_EXPEDIENTE} dígitos.`
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

  // El signo es opcional (sql/011_marcas_signo_opcional.sql): el listado de
  // DINAPI con que el estudio importa su cartera no lo trae. Si viene, tiene
  // que ser una de las cinco letras.
  if (marca.signo && !SIGNOS[marca.signo]) {
    errores.signo = 'El signo debe ser M, D, F, T o S.'
  }

  // Figurativas, tridimensionales y sonoras pueden no tener texto. Sin signo,
  // la denominación es obligatoria: si no, quedaría una marca sin texto ni
  // tipo. El mensaje dice las dos salidas posibles.
  if (!marca.denominacion && !SIGNOS_SIN_TEXTO.includes(marca.signo)) {
    errores.denominacion = marca.signo
      ? 'Ingresá la denominación.'
      : 'Ingresá la denominación, o elegí un signo figurativo, tridimensional o sonoro.'
  } else if (marca.denominacion.length > LARGO_MAXIMO_DENOMINACION) {
    errores.denominacion = `La denominación puede tener hasta ${LARGO_MAXIMO_DENOMINACION} caracteres.`
  }

  if (!marca.titular) {
    errores.titular = 'Ingresá el titular.'
  } else if (marca.titular.length > LARGO_MAXIMO_TITULAR) {
    errores.titular = `El titular puede tener hasta ${LARGO_MAXIMO_TITULAR} caracteres.`
  }

  if (!CODIGOS_PAIS.includes(marca.pais)) {
    errores.pais = 'País inválido (usá el código de 2 letras, ej.: PY).'
  }

  // ===== Datos del registro: todos opcionales =====
  // `?? ''`: quien llama a validarMarca sin pasar por normalizarMarca (o con
  // un objeto de antes de estos campos) no rompe.
  const estado = marca.estado ?? ''
  const numeroRegistro = marca.numero_registro ?? ''
  const fechaRegistro = marca.fecha_registro ?? ''
  const fechaVencimiento = marca.fecha_vencimiento ?? ''

  if (estado.length > LARGO_MAXIMO_ESTADO) {
    errores.estado = `El estado puede tener hasta ${LARGO_MAXIMO_ESTADO} caracteres.`
  }

  if (numeroRegistro && !/^\d+$/.test(numeroRegistro)) {
    errores.numero_registro = 'El número de registro solo puede tener números.'
  } else if (numeroRegistro.length > LARGO_MAXIMO_REGISTRO) {
    errores.numero_registro = `El número de registro puede tener hasta ${LARGO_MAXIMO_REGISTRO} dígitos.`
  }

  // El registro puede ser anterior a la solicitud cargada (pasa con
  // renovaciones), así que no se compara con fecha_solicitud.
  if (fechaRegistro && !esFechaISOValida(fechaRegistro)) {
    errores.fecha_registro = 'Fecha inválida (usá dd/mm/aaaa).'
  } else if (fechaRegistro > hoyISO()) {
    errores.fecha_registro = 'La fecha de registro no puede ser futura.'
  } else if (fechaRegistro && fechaRegistro < FECHA_MINIMA) {
    errores.fecha_registro = 'La fecha de registro no puede ser anterior a 1900.'
  }

  // El vencimiento sí puede ser futuro (es lo normal). Solo tiene que ser
  // posterior al registro, si los dos están.
  // El mensaje dice contra qué fecha se compara: así se sabe cómo corregirlo.
  if (fechaVencimiento && !esFechaISOValida(fechaVencimiento)) {
    errores.fecha_vencimiento = 'Fecha inválida (usá dd/mm/aaaa).'
  } else if (fechaVencimiento && fechaRegistro && !errores.fecha_registro && fechaVencimiento <= fechaRegistro) {
    errores.fecha_vencimiento = `El vencimiento tiene que ser posterior al ${formatFecha(fechaRegistro)} (fecha de registro).`
  } else if (fechaVencimiento && (fechaVencimiento < FECHA_MINIMA || fechaVencimiento > vencimientoMaximoISO())) {
    errores.fecha_vencimiento = `El vencimiento tiene que estar entre 1900 y los próximos ${AÑOS_MAXIMOS_VENCIMIENTO} años.`
  }

  return errores
}
