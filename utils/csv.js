// Separa una línea de CSV en celdas, respetando las comillas.
//
// `split(',')` no alcanza: un campo con coma adentro viene entre comillas
// ("Stanley Zarza, Patricia Elizabeth") y split lo partiría en dos.
// Reglas de CSV (RFC 4180) que cubre:
// - un campo entre comillas puede tener comas adentro;
// - una comilla dentro de un campo entre comillas se escribe doble ("").
export function parsearLineaCsv(linea) {
    const celdas = []
    let actual = ''
    let entreComillas = false

    for (let i = 0; i < linea.length; i++) {
        const c = linea[i]

        if (entreComillas) {
            if (c === '"' && linea[i + 1] === '"') {
                actual += '"' // comilla escapada: "" → "
                i++
            } else if (c === '"') {
                entreComillas = false
            } else {
                actual += c
            }
        } else if (c === '"') {
            entreComillas = true
        } else if (c === ',') {
            celdas.push(actual)
            actual = ''
        } else {
            actual += c
        }
    }

    celdas.push(actual)
    return celdas
}

// Lo inverso: arma una celda para escribir en un CSV. Solo agrega comillas
// si hacen falta (si el valor tiene coma, comilla o salto de línea).
export function celdaCsv(valor) {
    const texto = valor == null ? '' : String(valor)
    return /[",\r\n]/.test(texto) ? `"${texto.replaceAll('"', '""')}"` : texto
}
