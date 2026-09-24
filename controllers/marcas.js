export const handleMarcas = (req, res, db) => {
    const { id } = req.body
    db('users').where('id', '=', id)
    .increment('marcas', 1)
    .returning('marcas')
    .then(marcas => {
        res.json(marcas[0].marcas)
    })
    .catch(err => res.status(400).json('unable to get brands'))
}