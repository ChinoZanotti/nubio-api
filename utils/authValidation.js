// Validación de registro e inicio de sesión.
// COPIA en el frontend (repo `nubio`, src/utils/authValidation.js): si cambia
// una regla, cambiarla en los dos.

// 254 es el máximo que permite el estándar para una dirección de email.
export const LARGO_MAXIMO_EMAIL = 254
// La columna users.name es varchar(100).
export const LARGO_MAXIMO_NOMBRE = 100
export const LARGO_MINIMO_PASSWORD = 10
// bcrypt usa solo los primeros 72 BYTES de la contraseña y el resto lo ignora
// en silencio: "aaaa...a" (72) + "X" y + "Y" dan el mismo hash. En vez de dejar
// que alguien crea que su contraseña larga lo protege, ponemos el límite a la vista.
// Son bytes, no letras: en UTF-8 las letras con tilde y la ñ ocupan 2.
export const BYTES_MAXIMOS_PASSWORD = 72

// Un chequeo simple a propósito: algo@algo.algo, sin espacios. Validar emails
// "de verdad" con una regex es imposible; lo único que confirma que existe es
// mandarle un mail.
const FORMATO_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const bytes = (texto) => new TextEncoder().encode(texto).length

// "  Juan@Estudio.COM " -> "juan@estudio.com". Sin esto, Juan@x.com y
// juan@x.com serían dos cuentas distintas.
export function normalizarEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : ''
}

// Si llega algo que no es texto (un array, un objeto, un número), se trata como
// vacío. Así `password: ["a","b",...]` no pasa el chequeo de largo por accidente.
const comoTexto = (valor) => (typeof valor === 'string' ? valor : '')

export function validarEmail(email) {
  if (!email) return 'Ingresá tu correo electrónico.'
  if (email.length > LARGO_MAXIMO_EMAIL || !FORMATO_EMAIL.test(email)) {
    return 'Ingresá un correo electrónico válido.'
  }
  return null
}

export function validarPassword(password) {
  if (!password) return 'Ingresá una contraseña.'
  if (password.length < LARGO_MINIMO_PASSWORD) {
    return `La contraseña tiene que tener al menos ${LARGO_MINIMO_PASSWORD} caracteres.`
  }
  if (bytes(password) > BYTES_MAXIMOS_PASSWORD) {
    return `La contraseña puede tener hasta ${BYTES_MAXIMOS_PASSWORD} caracteres (las letras con tilde y la ñ cuentan doble).`
  }
  return null
}

// Devuelve { datos, errores }. `datos` ya viene normalizado (email en minúsculas,
// nombre sin espacios de más). La contraseña NO se recorta: un espacio al
// final puede ser parte de ella.
export function validarRegistro({ name, email, password }) {
  const datos = {
    name: comoTexto(name).trim(),
    email: normalizarEmail(email),
    password: comoTexto(password),
  }

  const errores = {}
  if (!datos.name) errores.name = 'Ingresá tu nombre.'
  else if (datos.name.length > LARGO_MAXIMO_NOMBRE) {
    errores.name = `El nombre puede tener hasta ${LARGO_MAXIMO_NOMBRE} caracteres.`
  }

  const errorEmail = validarEmail(datos.email)
  if (errorEmail) errores.email = errorEmail

  const errorPassword = validarPassword(datos.password)
  if (errorPassword) errores.password = errorPassword

  return { datos, errores }
}
