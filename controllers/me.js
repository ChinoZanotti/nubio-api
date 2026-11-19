import { registrarError } from '../utils/log.js'

// GET /me: los datos del usuario logueado. Reemplaza a GET /profile/:id, que
// devolvía cualquier usuario por id (con eso se podía armar la lista de emails
// de todos). Acá no hay id en la URL: el usuario sale del token.
export const handleMe = async (req, res, db) => {
    try {
        const user = await db('users')
            .select('id', 'name', 'email', 'joined')
            .where({ id: req.userId })
            .first()

        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado.' })
        }
        res.json(user)
    } catch (err) {
        registrarError('GET /me', err)
        res.status(500).json({ error: 'No se pudo obtener el usuario.' })
    }
}
