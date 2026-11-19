import { firmarToken } from '../utils/token.js'

export const handleSignin = async (req, res, db, bcrypt) => {
    const { email, password } = req.body
    if (!email || !password) {
        return res.status(400).json('incorrect form submission')
    }
    try {
        const data = await db
            .select('email', 'hash')
            .from('login')
            .where('email', "=", email);

        if (data.length === 0) {
            return res. status(400).json('wrong credentials');
        }

        const isValid = await bcrypt.compare(password, data[0].hash);

        if (!isValid) {
            return res.status(400).json('wrong credentials');
        }

        // Columnas explícitas: con select('*') cualquier columna que se agregue
        // a users en el futuro saldría sola hacia el cliente.
        const user = await db('users')
            .select('id', 'name', 'email', 'joined')
            .where('email', '=', email)
            .first();

        // El token es la "credencial" que el frontend manda en cada pedido.
        // Lo firma el servidor con JWT_SECRET: el cliente no lo puede fabricar
        // ni cambiarle el id adentro sin que la firma deje de coincidir.
        res.json({ token: firmarToken(user.id), user });
    } catch (err) {
        console.error(err);
        res.status(400).json('wrong credentials');
    }
}