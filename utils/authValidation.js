// Validación de registro e inicio de sesión.
// COPIA en el frontend (repo `nubio`, src/utils/authValidation.js): si cambia
// una regla, cambiarla en los dos.

// 254 es el máximo que permite el estándar para una dirección de email.
export const LARGO_MAXIMO_EMAIL = 254
// La columna users.name es varchar(100).
export const LARGO_MAXIMO_NOMBRE = 100
// Política de contraseñas (noviembre 2026, recomendación de Case basada en
// NIST SP 800-63B-4 y OWASP ASVS 5.0):
// - mínimo 15 caracteres: NIST lo pide cuando la contraseña es el ÚNICO factor
//   (sin 2FA), como hoy en Nubio. Con 2FA se podría bajar;
// - sin reglas de composición (mayúscula, número, símbolo): NIST las prohíbe,
//   porque producen "Marca2026!" y no contraseñas más difíciles;
// - no puede incluir el nombre, el correo ni el nombre de la app;
// - el backend además la rechaza si aparece en filtraciones (passwordFiltrada.js).
export const LARGO_MINIMO_PASSWORD = 15
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

// Caracteres REALES, no unidades UTF-16: "hola😀".length da 6, pero son 5
// caracteres. [...texto] separa por caracteres (puntos de código), como pide NIST.
export const contarCaracteres = (texto) => [...texto].length

// Palabras que hacen fácil de adivinar una contraseña PARA ESTA APP: el
// atacante las prueba primero. NIST pide rechazar las "específicas del contexto".
const PALABRAS_DE_LA_APP = ['nubio', 'dinapi']
// Más cortas que esto no se buscan: "ana" o "luz" aparecerían por casualidad
// dentro de muchas frases sin ser un problema.
const LARGO_MINIMO_PALABRA_PERSONAL = 4

// Minúsculas y sin tildes, para que "Núbio" o "MARÍA" también se detecten.
const simplificar = (texto) => texto.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')

// Palabras personales: el nombre y la parte del correo antes de la @, también
// partida en pedazos ("juan.perez" -> "juan.perez", "juan", "perez").
function palabrasPersonales({ email = '', name = '' }) {
  const local = simplificar(email.split('@')[0] ?? '')
  const candidatas = [local, ...local.split(/[^\p{L}\p{N}]+/u), ...simplificar(name).split(/\s+/)]
  return candidatas.filter((p) => p.length >= LARGO_MINIMO_PALABRA_PERSONAL)
}

// `usuario` es opcional ({ email, name }): sin él, solo se chequean las
// palabras de la app.
export function validarPassword(password, usuario = {}) {
  if (!password) return 'Ingresá una contraseña.'
  const largo = contarCaracteres(password)
  if (largo < LARGO_MINIMO_PASSWORD) {
    const faltan = LARGO_MINIMO_PASSWORD - largo
    return `Te ${faltan === 1 ? 'falta 1 carácter' : `faltan ${faltan} caracteres`} (mínimo ${LARGO_MINIMO_PASSWORD}).`
  }
  if (bytes(password) > BYTES_MAXIMOS_PASSWORD) {
    return `Es demasiado larga: el máximo es de ${BYTES_MAXIMOS_PASSWORD} caracteres (las letras con tilde y la ñ cuentan doble).`
  }
  const simple = simplificar(password)
  if ([...PALABRAS_DE_LA_APP, ...palabrasPersonales(usuario)].some((p) => simple.includes(p))) {
    return 'Es muy fácil de adivinar: incluye tu nombre, tu correo o el nombre de la app. Elegí otra.'
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

  const errorPassword = validarPassword(datos.password, datos)
  if (errorPassword) errores.password = errorPassword

  return { datos, errores }
}
