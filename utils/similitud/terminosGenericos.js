// Palabras que se ignoran al comparar porque no distinguen una marca de otra.
// El criterio jurídico de cotejo dice que los términos genéricos o de uso común
// no se pueden apropiar, así que coincidir en ellos no es un conflicto.
//
// Validada por la abogada (noviembre 2026). Las palabras DESCRIPTIVAS de un
// rubro (CAFE en la 30) no van acá: dependen de la clase, ver
// terminosDescriptivos.js.
// Van ya normalizados: mayúsculas, sin acentos ni puntos.
export const TERMINOS_GENERICOS = new Set([
    // Formas societarias
    'SA', 'SRL', 'SACI', 'SAE', 'SAECA', 'SAIC', 'LTDA', 'CIA', 'INC', 'CORP', 'LLC', 'GMBH', 'LTD',
    // Geográficos
    'PARAGUAY', 'PARAGUAYA', 'PARAGUAYO', 'PY',
    // Ruido que DINAPI deja en la denominación: "BIGWAY y Logo", "... (Slogan)",
    // "(Eslogan)"
    'LOGO', 'SLOGAN', 'ESLOGAN',
    // Artículos y conectores
    'DE', 'DEL', 'LA', 'EL', 'LOS', 'LAS', 'Y', 'E', 'THE', 'AND', 'OF',
    // Sumadas en noviembre 2026: de las más repetidas en todas las clases de
    // los boletines, y no distinguen nada. MAS ("más") NO va: puede ser lo
    // distintivo de una marca (un supermercado "MÁS"), y una marca hecha solo
    // de genéricas se compara entera de su lado pero no del otro ("MAS" contra
    // "SUPER MAS" quedaba MAS contra SUPER; revisión de Case del motor, M5).
    'QUE', 'PARA', 'CON',
])
