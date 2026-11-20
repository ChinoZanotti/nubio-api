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
// - message: el texto del error. Knex le antepone la consulta, pero con
//   $1, $2... y SIN los valores (verificado con pg). En casi todos los errores
//   de Postgres el mensaje tampoco trae datos (esos van en `detail`).
//
// Excepción (tercera revisión de Case, M1): los errores de TIPO DE DATO
// (códigos 22xxx: fecha inválida, número fuera de rango, texto que no es
// número...) repiten en el mensaje el valor rechazado:
//   el valor «99999» está fuera de rango para el tipo smallint
// Para esos, el mensaje se omite: el código ya dice qué clase de problema fue.
export function describirError(err) {
    if (!err) return 'error desconocido'
    const partes = []
    if (err.code) partes.push(`code=${err.code}`)
    if (err.constraint) partes.push(`constraint=${err.constraint}`)
    if (String(err.code ?? '').startsWith('22')) {
        partes.push('(mensaje omitido: los errores de tipo de dato incluyen el valor rechazado)')
    } else {
        partes.push(err.message ?? String(err))
    }
    return partes.join(' ')
}

export function registrarError(contexto, err) {
    console.error(`${contexto}:`, describirError(err))
}
