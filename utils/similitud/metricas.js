// Medidas de parecido entre dos textos. Todas devuelven un número entre 0
// (nada que ver) y 1 (idénticos).

// Rendimiento: estas funciones se llaman millones de veces al generar alertas
// (cada marca propia contra miles del boletín, palabra por palabra). Por eso
// reusan buffers de números (typed arrays) en vez de crear un arreglo nuevo en
// cada llamada, y comparan códigos de letra (charCodeAt) en vez de strings.
// El cálculo es el mismo; solo se evita trabajo de memoria.
// Los buffers se comparten entre llamadas: sirve porque son funciones
// síncronas (nunca hay dos corriendo a la vez en el mismo hilo).
let filaLev = new Int32Array(64)
let usadasA = new Uint8Array(64)
let usadasB = new Uint8Array(64)

function asegurarLargo(buffer, largo) {
    if (buffer.length >= largo) return buffer
    return new buffer.constructor(Math.max(largo, buffer.length * 2))
}

// Levenshtein: cuántas letras hay que agregar, borrar o cambiar para pasar de
// un texto al otro. "RIVAN" -> "RIBAN" es 1 cambio.
export function lev(a, b) {
    const m = a.length
    const n = b.length
    if (!m) return n
    if (!n) return m
    filaLev = asegurarLargo(filaLev, n + 1)
    const fila = filaLev
    for (let j = 0; j <= n; j++) fila[j] = j
    for (let i = 1; i <= m; i++) {
        const letra = a.charCodeAt(i - 1)
        let anterior = fila[0]
        fila[0] = i
        for (let j = 1; j <= n; j++) {
            const tmp = fila[j]
            fila[j] = Math.min(tmp + 1, fila[j - 1] + 1, anterior + (letra === b.charCodeAt(j - 1) ? 0 : 1))
            anterior = tmp
        }
    }
    return fila[n]
}

// Levenshtein convertido a parecido: 1 cambio en 5 letras = 0.8
export function levSim(a, b) {
    const largo = Math.max(a.length, b.length)
    return largo ? 1 - lev(a, b) / largo : 1
}

// Jaro: cuenta letras en común que están en posiciones cercanas.
export function jaro(a, b) {
    if (a === b) return 1
    const m = a.length
    const n = b.length
    if (!m || !n) return 0
    const ventana = Math.max(0, Math.floor(Math.max(m, n) / 2) - 1)
    usadasA = asegurarLargo(usadasA, m)
    usadasB = asegurarLargo(usadasB, n)
    usadasA.fill(0, 0, m)
    usadasB.fill(0, 0, n)
    let coincidencias = 0
    for (let i = 0; i < m; i++) {
        const letra = a.charCodeAt(i)
        const hasta = Math.min(n, i + ventana + 1)
        for (let j = Math.max(0, i - ventana); j < hasta; j++) {
            if (!usadasB[j] && letra === b.charCodeAt(j)) {
                usadasA[i] = usadasB[j] = 1
                coincidencias++
                break
            }
        }
    }
    if (!coincidencias) return 0
    let transposiciones = 0
    let k = 0
    for (let i = 0; i < m; i++) {
        if (!usadasA[i]) continue
        while (!usadasB[k]) k++
        if (a.charCodeAt(i) !== b.charCodeAt(k)) transposiciones++
        k++
    }
    transposiciones /= 2
    return (coincidencias / m + coincidencias / n + (coincidencias - transposiciones) / coincidencias) / 3
}

// Jaro-Winkler: Jaro + un premio si empiezan igual (hasta 4 letras).
// Encaja con el criterio de cotejo de que el comienzo de una marca pesa más.
export function jaroWinkler(a, b) {
    const j = jaro(a, b)
    let prefijo = 0
    while (prefijo < 4 && a[prefijo] && a[prefijo] === b[prefijo]) prefijo++
    return j + prefijo * 0.1 * (1 - j)
}

// Promedio de las dos. Jaro-Winkler solo es muy generoso cuando el comienzo
// coincide ("CAFE NUBIO" vs "CAFE TORRES" da 0.8); Levenshtein lo compensa.
export const simRatio = (a, b) => (jaroWinkler(a, b) + levSim(a, b)) / 2
