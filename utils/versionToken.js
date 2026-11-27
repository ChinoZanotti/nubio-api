// Versión vigente de las sesiones de cada usuario (users.token_version), con
// un caché en memoria para no consultar la base en cada pedido.
//
// Por qué: un JWT vale hasta que vence (8 h) y no se puede "borrar". Para que
// cambiar la contraseña cierre las demás sesiones, cada token lleva la versión
// con la que se emitió (claim `tv`) y requireAuth la compara con la de la
// base. Al cambiar la contraseña la versión sube y los tokens viejos dejan de
// coincidir. (I3 de la segunda revisión de Case; diseño propuesto por Case.)
//
// El caché: sin él, cada pedido autenticado sumaría un SELECT a Neon (pool de
// 10 conexiones; Boletines llega a 60 pedidos por minuto por usuario). Con él,
// a lo sumo uno por usuario cada TTL_MS.
// - Lo que cambia la API (handleCambiarPassword) actualiza el caché al toque
//   con `recordar`: la revocación es inmediata.
// - El TTL solo importa para cambios hechos por fuera de la API (un UPDATE a
//   mano en Neon): tardan hasta TTL_MS en notarse.
// - Vive en memoria y alcanza con una sola instancia en Render. Con más de una,
//   las otras se enteran recién al vencer el TTL: ese pasa a ser el tiempo de
//   revocación. Para que siga siendo inmediata, LISTEN/NOTIFY de Postgres o Redis.

const TTL_MS = 30 * 1000
// Tope de usuarios en el caché: al pasarlo se descarta el más viejo (un Map
// recuerda el orden de inserción). Sobra para los usuarios reales de Nubio.
const MAX_ENTRADAS = 10_000

// Guarda también la cuenta del usuario (users.cuenta_id, sql/012): requireAuth
// la necesita en cada pedido, y así sale de la misma consulta y del mismo caché.
const cache = new Map() // userId -> { tv, cuentaId, hasta (ms) }

// Guarda la versión de un usuario. Mientras la entrada está vigente, NO la
// baja. Importa por esta carrera: un pedido consulta la base y lee 0; mientras
// espera, otro cambia la contraseña y guarda 1; llega la respuesta del primero
// y, si pisara, volvería a 0 y los tokens revocados valdrían 30 s más.
// Vencida, sí acepta una menor (revisión de Case de I3): si la versión baja
// en la base (un restore de Neon, un UPDATE a mano), la base manda. Si no, el
// usuario quedaba afuera hasta reiniciar el servidor: signin firmaba con la
// versión de la base y requireAuth comparaba con la del caché.
// cuentaId: si no se pasa, se conserva la que ya estaba.
export function recordar(userId, tv, cuentaId, ahora = Date.now()) {
    const previo = cache.get(userId)
    if (previo && previo.hasta > ahora && previo.tv > tv) return
    cache.delete(userId)
    cache.set(userId, { tv, cuentaId: cuentaId ?? previo?.cuentaId, hasta: ahora + TTL_MS })
    if (cache.size > MAX_ENTRADAS) cache.delete(cache.keys().next().value)
}

// Devuelve { tv, cuentaId } del usuario, o null si el usuario ya no existe.
// `ahora` se puede pasar en los tests para no depender del reloj real.
export async function sesionVigente(db, userId, ahora = Date.now()) {
    const enCache = cache.get(userId)
    if (enCache && enCache.hasta > ahora && enCache.cuentaId != null) {
        return { tv: enCache.tv, cuentaId: enCache.cuentaId }
    }

    const fila = await db('users').select('token_version', 'cuenta_id').where({ id: userId }).first()
    if (!fila) {
        cache.delete(userId)
        return null
    }
    recordar(userId, fila.token_version, fila.cuenta_id, ahora)
    // Lo que quedó en el caché, no lo leído: si mientras tanto alguien subió
    // la versión, gana la nueva (ver recordar). La cuenta, la leída.
    return { tv: cache.get(userId).tv, cuentaId: fila.cuenta_id }
}

// Solo la versión (la usan los tests de la revocación).
export async function versionVigente(db, userId, ahora = Date.now()) {
    const enCache = cache.get(userId)
    if (enCache && enCache.hasta > ahora) return enCache.tv
    const sesion = await sesionVigente(db, userId, ahora)
    return sesion === null ? null : sesion.tv
}

// Solo para los tests.
export function reiniciarVersiones() {
    cache.clear()
}
