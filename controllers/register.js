export const handleRegister = async (req, res, db, bcrypt) => {
    const { email, name, password } = req.body
    const saltRounds = 10

    if (!email || !name || !password) {
        return res.status(400).json('incorrect form submission')
    }

    if (password.length < 10) {
        return res.status(400).json('la contraseña debe tener al menos 10 caracteres')
    }

    try {
        const hash = await bcrypt.hash(password, saltRounds)

        const newUser = await db.transaction(async (trx) => {
            const [loginEmail] = await trx('login')
                .insert({ hash, email })
                .returning('email')

            const [user] = await trx('users')
                .insert({
                    email: loginEmail.email ?? loginEmail,
                    name,
                    joined: new Date(), 
                })
                .returning('*')

            return user
        })

        res.json(newUser)
    } catch (err) {
        console.error(err)
        res.status(400).json('unable to register')
    }    
}