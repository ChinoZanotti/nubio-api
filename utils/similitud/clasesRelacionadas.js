// Clases Niza que suelen considerarse relacionadas (productos o servicios que
// el público puede asociar a un mismo origen). La Ley 1294/98, art. 15, protege
// contra la confusión "cualquiera sea la clase en que figuren, siempre que
// tengan relación entre ellos": por eso la clase pondera el puntaje, no filtra.
//
// PENDIENTE: validar la lista con el abogado.
const PARES = [
    [3, 5], [3, 44], [5, 10], [5, 44], // cosmética, farmacia, salud
    [9, 38], [9, 42], // tecnología
    [14, 25], [18, 25], // moda
    [29, 30], [29, 31], [30, 31], [29, 43], [30, 43], // alimentos y gastronomía
    [32, 33], [33, 43], // bebidas
    [16, 41], // papelería y educación
    [6, 37], [19, 37], [12, 37], // construcción, vehículos y su reparación
    [7, 11], [12, 39],
]

const RELACIONADAS = new Map()
for (const [a, b] of PARES) {
    if (!RELACIONADAS.has(a)) RELACIONADAS.set(a, new Set())
    if (!RELACIONADAS.has(b)) RELACIONADAS.set(b, new Set())
    RELACIONADAS.get(a).add(b)
    RELACIONADAS.get(b).add(a)
}

// Devuelve 'misma', 'relacionada' u 'otra'.
export function relacionClase(a, b) {
    const ca = Number(a)
    const cb = Number(b)
    if (!ca || !cb) return 'relacionada' // sin dato de clase: no premiamos ni castigamos
    if (ca === cb) return 'misma'
    return RELACIONADAS.get(ca)?.has(cb) ? 'relacionada' : 'otra'
}
