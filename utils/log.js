// Log de errores sin datos personales.
//
// console.error(err) con un error de Postgres imprime TODAS sus propiedades,
// incluida `detail`, donde Postgres copia los datos que causaron el problema:
//   "Key (email)=(ana@estudio.com) already exists"
//   "Failing row contains (12, 7, ..., ACME SA, ...)"   <- titular, user_id
// Los logs de Render los ve cualquiera con acceso al dashboard y se guardan
// días: no son lugar para datos de clientes.
//
// Esto deja lo que sirve para investigar sin exponer a nadie:
// - code: el código de Postgres (23505 = unique, 23514 = check, ...);
// - constraint: el NOMBRE de la restricción que falló (no los valores);
// - message: el texto del error. En los errores de Postgres no trae los datos
//   de la fila (eso está en `detail`).
export function describirError(err) {
    if (!err) return 'error desconocido'
    const partes = []
    if (err.code) partes.push(`code=${err.code}`)
    if (err.constraint) partes.push(`constraint=${err.constraint}`)
    partes.push(err.message ?? String(err))
    return partes.join(' ')
}

export function registrarError(contexto, err) {
    console.error(`${contexto}:`, describirError(err))
}
