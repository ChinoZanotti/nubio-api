// Palabras que se ignoran al comparar porque no distinguen una marca de otra.
// El criterio jurídico de cotejo dice que los términos genéricos o de uso común
// no se pueden apropiar, así que coincidir en ellos no es un conflicto.
//
// PENDIENTE: validar con el abogado y sumar términos descriptivos por rubro
// (ej: CAFE en clase 30, FARMA en clase 5).
// Van ya normalizados: mayúsculas, sin acentos ni puntos.
export const TERMINOS_GENERICOS = new Set([
    // Formas societarias
    'SA', 'SRL', 'SACI', 'SAE', 'SAECA', 'SAIC', 'LTDA', 'CIA', 'INC', 'CORP', 'LLC', 'GMBH', 'LTD',
    // Geográficos
    'PARAGUAY', 'PARAGUAYA', 'PARAGUAYO', 'PY',
    // Ruido que DINAPI deja en la denominación: "BIGWAY y Logo", "... (Slogan)"
    'LOGO', 'SLOGAN',
    // Artículos y conectores
    'DE', 'DEL', 'LA', 'EL', 'LOS', 'LAS', 'Y', 'E', 'THE', 'AND', 'OF',
])
