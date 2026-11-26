// Id que llega en la URL (/marcas/:id, /alertas/:id). Tiene que ser un entero
// positivo que entre en un INTEGER de Postgres: con "abc" o un número enorme,
// la consulta fallaba en la base y respondía 500 en vez de 400.
const MAXIMO_INTEGER = 2_147_483_647

export function parseId(valor) {
    const id = Number(valor)
    return Number.isInteger(id) && id > 0 && id <= MAXIMO_INTEGER ? id : null
}
