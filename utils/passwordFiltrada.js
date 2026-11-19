import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

// ¿La contraseña aparece en filtraciones? Si sí, es de las primeras que prueba
// un atacante (credential stuffing: prueba en Nubio las contraseñas filtradas
// de otros sitios). Largo no alcanza: "123456789qwerty123" tiene 18 caracteres
// y está en todas las listas.
//
// 1) Have I Been Pwned (Pwned Passwords), con k-anonimato:
//    - calculamos el SHA-1 de la contraseña;
//    - mandamos SOLO los primeros 5 caracteres del hash (de 40);
//    - HIBP devuelve todos los hashes filtrados que empiezan así (cientos) y
//      la comparación se hace acá. Ni la contraseña ni su hash completo salen
//      del servidor: HIBP no puede saber cuál de esos cientos era.
//    - Add-Padding: HIBP agrega entradas falsas (con contador 0) para que el
//      tamaño de la respuesta tampoco revele nada.
//    Es gratis y no necesita clave.
// 2) Si HIBP no responde a tiempo: una lista local con las ~11.000 contraseñas
//    filtradas de 15 caracteres o más más comunes (data/passwords-comunes.txt,
//    sacadas de SecLists, xato-net 1M, licencia MIT). No es tan completa, pero
//    un servicio externo caído no tiene que impedir que alguien se registre.
//    La lista se consulta siempre (es instantánea); HIBP, solo si no está ahí.

const URL_HIBP = 'https://api.pwnedpasswords.com/range/'
const TIEMPO_MAXIMO_MS = 2000

const comunes = new Set(
    readFileSync(new URL('../data/passwords-comunes.txt', import.meta.url), 'utf8')
        .split(/\r?\n/)
        .filter(Boolean),
)

export const MENSAJE_FILTRADA =
    'Esta contraseña apareció en filtraciones de otros sitios, así que es de las primeras que prueban los atacantes. Elegí otra.'

// Devuelve { filtrada, fuente }. `fuente` dice con qué se decidió: 'hibp' o
// 'lista-local' (útil para los logs y los tests).
// `fetchFn` se puede reemplazar en los tests para no salir a internet.
export async function revisarFiltrada(password, { fetchFn = fetch, timeoutMs = TIEMPO_MAXIMO_MS } = {}) {
    if (comunes.has(password.toLowerCase())) return { filtrada: true, fuente: 'lista-local' }

    const hash = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase()
    const prefijo = hash.slice(0, 5)
    const resto = hash.slice(5)

    try {
        const res = await fetchFn(URL_HIBP + prefijo, {
            headers: { 'Add-Padding': 'true' },
            signal: AbortSignal.timeout(timeoutMs),
        })
        if (!res.ok) throw new Error(`HIBP respondió ${res.status}`)
        const texto = await res.text()
        // Cada línea: "SUFIJO:CANTIDAD". Las de relleno tienen cantidad 0.
        const filtrada = texto.split(/\r?\n/).some((linea) => {
            const [sufijo, cantidad] = linea.split(':')
            return sufijo === resto && Number(cantidad) > 0
        })
        return { filtrada, fuente: 'hibp' }
    } catch (err) {
        // Nunca loguear la contraseña ni su hash. Solo que HIBP no estuvo.
        console.warn('No se pudo consultar Have I Been Pwned; se usó solo la lista local:', err.message)
        return { filtrada: false, fuente: 'lista-local' }
    }
}
