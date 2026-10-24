const COLUMNAS = [
    'id', 'fecha_publicacion', 'expediente', 'clase_niza', 'denominacion', 'signo',
    'titular', 'pais', 'agente', 'matricula', 'tramite', 'referencia',
]

// Las marcas del boletín son públicas: no se filtran por usuario.
export const handleGetBoletinMarcas = async (req, res, db) => {
    try {
        const marcas = await db('boletin_marcas')
            .select(COLUMNAS)
            .orderBy([
                { column: 'fecha_publicacion', order: 'desc' },
                { column: 'expediente', order: 'asc' },
            ])
        res.json(marcas)
    } catch (err) {
        console.error(err)
        res.status(500).json({ error: 'No se pudieron obtener las marcas del boletín.' })
    }
}
