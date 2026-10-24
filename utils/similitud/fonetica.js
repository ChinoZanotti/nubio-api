// Claves fonéticas: convierten una palabra en "cómo suena", para que dos marcas
// escritas distinto pero que se pronuncian igual den la misma clave.
// Ej: "BIOTHERM" y "BIOTERM" -> "BIOTERM"; "RIVAN" y "RIBAN" -> "RIBAN".
//
// Hay dos lecturas porque en Paraguay conviven el español y el guaraní, y algunas
// letras suenan distinto en cada idioma (la J y la H sobre todo). Se compara cada
// lectura por separado y se queda con la que da más parecido.
// Esperan texto ya normalizado (ver normalizar.js).

const VOCALES = 'AEIOU'

function clavePalabraEspanol(palabra) {
    let t = palabra

    // Marcas en inglés, como las pronuncia un hispanohablante. Van primero porque
    // las reglas del español romperían estos grupos (ej: la H de "TH").
    t = t.replace(/PH/g, 'F').replace(/TH/g, 'T').replace(/CK/g, 'K')
    t = t.replace(/OO/g, 'U').replace(/EE/g, 'I')

    // La X original suena "KS". Va antes que CH y SH, que usan la X como marcador.
    t = t.replace(/X/g, 'KS')
    t = t.replace(/CH/g, 'X').replace(/SH/g, 'X')

    t = t.replace(/QU/g, 'K').replace(/Q/g, 'K')
    // El orden importa: si primero hiciéramos "GUE" -> "GE", la regla siguiente
    // lo convertiría en "JE" y "GUERRA" terminaría sonando "JERRA".
    t = t.replace(/G([EI])/g, 'J$1') // "GE" suena "JE"
    t = t.replace(/GU([EI])/g, 'G$1') // "GUE" suena "GE" con G dura
    t = t.replace(/C([EI])/g, 'S$1') // seseo: "CE" suena "SE"
    t = t.replace(/C/g, 'K')
    t = t.replace(/Z/g, 'S') // seseo
    t = t.replace(/V/g, 'B') // B y V suenan igual
    t = t.replace(/W/g, 'U') // "WILSON" se dice "UILSON"
    t = t.replace(/LL/g, 'Y') // yeísmo
    t = t.replace(/Y/g, 'I')
    t = t.replace(/H/g, '') // H muda
    t = t.replace(/N(?=B)/g, 'M') // "INVICTO" se dice "IMBICTO"

    // "SPRITE" se dice "ESPRITE": la S inicial seguida de consonante suma una E.
    if (/^S/.test(t) && t[1] && !VOCALES.includes(t[1])) t = 'E' + t

    t = t.replace(/(.)\1+/g, '$1') // letras dobles: "RR" -> "R", "SS" -> "S"
    t = t.replace(/(.{3,})S$/, '$1') // plural: "MARCAS" -> "MARKA"; "GAS" queda igual
    return t
}

// En guaraní la J suena parecida a la Y española ("JASY" ~ "YASY") y la H es
// aspirada, como la J española ("HU" ~ "JU"). Las cambiamos y después aplicamos
// las reglas del español para el resto de las letras.
function clavePalabraGuarani(palabra) {
    const t = palabra
        .replace(/J/g, 'Y')
        .replace(/(?<![CSPT])H/g, 'J') // sin tocar CH, SH, PH ni TH
        .replace(/^MB/, 'B') // "MBURUCUYA" ~ "BURUCUYA"
        .replace(/^ND/, 'D')
    return clavePalabraEspanol(t)
}

const porPalabra = (fn) => (texto) => texto.split(' ').filter(Boolean).map(fn).join(' ')

export const claveEspanol = porPalabra(clavePalabraEspanol)
export const claveGuarani = porPalabra(clavePalabraGuarani)
