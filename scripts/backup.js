// Backup de la base de producción con pg_dump (noviembre 2026).
//
//   npm run backup
//
// Lee la configuración de un archivo FUERA del repo, para que la URL de Neon
// (con la contraseña) no quede nunca en git ni en el .env de desarrollo:
//   %USERPROFILE%\.nubio\backup.env   (o la ruta en NUBIO_BACKUP_ENV)
// con:
//   BACKUP_DATABASE_URL=postgresql://...neon.tech/...   (la misma de Render)
//   BACKUP_DIR=C:\Users\...\Backups\nubio               (opcional)
//   BACKUP_CONSERVAR=30                                 (opcional, cuántos guardar)
//   PG_BIN=C:\Program Files\PostgreSQL\18\bin           (opcional, si pg_dump no está en el PATH)
//
// Paso a paso, programarlo y cómo restaurar: docs/backups.md.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import tls from 'node:tls'
import { join, resolve, sep } from 'node:path'
import dotenv from 'dotenv'

const archivoConfig = process.env.NUBIO_BACKUP_ENV ?? join(homedir(), '.nubio', 'backup.env')
if (existsSync(archivoConfig)) dotenv.config({ path: archivoConfig, quiet: true })

const urlTexto = process.env.BACKUP_DATABASE_URL
if (!urlTexto) {
    console.error(`Falta BACKUP_DATABASE_URL. Ponela en ${archivoConfig} (ver docs/backups.md).`)
    process.exit(1)
}

// Cualquier error de configuración corta ANTES de conectarse o de borrar nada.
function fallar(mensaje) {
    console.error(mensaje)
    process.exit(1)
}

// La carpeta tiene que estar dentro de la del usuario: ahí Windows deja leer
// solo a esta cuenta (y a los administradores). Una carpeta en la raíz de C:
// hereda lectura para todos los usuarios de la máquina, y los .dump tienen los
// datos de los clientes sin cifrar (revisión de Case del backup, M4).
const carpeta = resolve(process.env.BACKUP_DIR ?? join(homedir(), 'Backups', 'nubio'))
const enWindows = process.platform === 'win32'
const comparable = (ruta) => (enWindows ? ruta.toLowerCase() : ruta)
if (!comparable(carpeta).startsWith(comparable(resolve(homedir()) + sep))) {
    fallar(`BACKUP_DIR tiene que estar dentro de ${homedir()} (está en ${carpeta}).`)
}

// Cuántos backups conservar. Tiene que ser un entero de 1 en adelante: con un
// valor inválido ("30 dias" da NaN) o 0, la rotación borraba TODOS los
// backups, incluido el recién hecho (revisión de Case del backup, M3).
const conservar = Number(process.env.BACKUP_CONSERVAR ?? 30)
if (!Number.isInteger(conservar) || conservar < 1) {
    fallar(`BACKUP_CONSERVAR tiene que ser un número entero de 1 en adelante (está en "${process.env.BACKUP_CONSERVAR}").`)
}
const pgDump = process.env.PG_BIN ? join(process.env.PG_BIN, 'pg_dump') : 'pg_dump'
const pgRestore = process.env.PG_BIN ? join(process.env.PG_BIN, 'pg_restore') : 'pg_restore'

// Si la URL está mal escrita, new URL tira un error que Node imprime con la URL
// entera, contraseña incluida, y la tarea programada lo guardaría en el log
// (revisión de Case del backup, B1). Por eso se atrapa y se da otro mensaje.
let url
try {
    url = new URL(urlTexto)
} catch {
    fallar(`BACKUP_DATABASE_URL no es una URL válida. Revisala en ${archivoConfig}.`)
}
const esNeon = url.hostname.endsWith('neon.tech')
// Sin TLS solo se acepta una base en esta misma máquina (para probar el script
// en local). Cualquier otro servidor va cifrado y verificado, sea Neon o no: si
// algún día se cambia de proveedor, el backup no puede pasar a viajar en claro
// (revisión de Case del backup, B2).
const esLocal = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)

// Neon recomienda pg_dump por la conexión DIRECTA, no por el pooler (PgBouncer,
// host con "-pooler"): el pooler reparte las consultas entre conexiones y un
// dump largo necesita una sola sesión de principio a fin.
if (esNeon) url.hostname = url.hostname.replace('-pooler.', '.')

// Los datos de conexión van por variables de entorno de libpq y no en la línea
// de comandos: los argumentos de un proceso los puede ver cualquier programa
// de la máquina (el administrador de tareas), y ahí estaría la contraseña.
const entorno = {
    ...process.env,
    // pg_dump no necesita la URL entera: los datos van separados abajo
    // (revisión de Case del backup, I4).
    BACKUP_DATABASE_URL: undefined,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: url.pathname.slice(1),
}
// La misma regla que db.js: cifrado Y certificado verificado (verify-full
// revisa también que el host sea el que pedimos). Para verificar, libpq
// necesita los certificados raíz en un archivo. "system" no sirve en Windows
// (el OpenSSL de PostgreSQL no lee el almacén de Windows), así que se usan los
// que trae Node, los mismos con que la API verifica a Neon.
// El archivo va en ~/.nubio, la misma carpeta privada que la configuración, y
// no en la carpeta temporal: en Linux /tmp es compartida, y otra cuenta podría
// crear antes un archivo con ese nombre y meterle su propia CA (B3).
if (!esLocal) {
    const carpetaNubio = join(homedir(), '.nubio')
    mkdirSync(carpetaNubio, { recursive: true })
    const raices = join(carpetaNubio, 'certificados-raiz.pem')
    writeFileSync(raices, tls.rootCertificates.join('\n'), { mode: 0o600 })
    entorno.PGSSLMODE = 'verify-full'
    entorno.PGSSLROOTCERT = raices
    // Channel binding (lo que pide channel_binding=require en la URL de Neon):
    // ata el login (SCRAM) a ESTA conexión TLS. Con verify-full ya se sabe que
    // del otro lado está Neon; esto suma que la contraseña no sirve para otra
    // conexión aunque alguien se meta en el medio. Va aparte porque el script
    // no usa los parámetros de la URL: arma la conexión campo por campo.
    entorno.PGCHANNELBINDING = 'require'
}

mkdirSync(carpeta, { recursive: true })

// Restos de corridas cortadas a la mitad (se apagó la PC, se mató la tarea): un
// .parcial es un dump casi completo y sin cifrar que la rotación no ve (B5). Se
// borran los de más de un día, para no tocar uno de otra corrida en curso.
const UN_DIA = 24 * 60 * 60 * 1000
for (const f of readdirSync(carpeta).filter((f) => /^nubio-.*\.dump\.parcial$/.test(f))) {
    const ruta = join(carpeta, f)
    if (Date.now() - statSync(ruta).mtimeMs > UN_DIA) {
        unlinkSync(ruta)
        console.log(`Borrado backup incompleto: ${f}`)
    }
}
// Hora local con segundos (aaaa-mm-dd_hhmmss): dos backups seguidos no se pisan
// y el nombre ordena por fecha.
const d = new Date()
const dos = (n) => String(n).padStart(2, '0')
const sello = `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}_${dos(d.getHours())}${dos(d.getMinutes())}${dos(d.getSeconds())}`
const destino = join(carpeta, `nubio-${sello}.dump`)
// Se escribe con otro nombre y se renombra al final: si pg_dump falla a mitad,
// no queda un .dump incompleto que parezca bueno.
const temporal = `${destino}.parcial`

console.log(`Haciendo backup de ${url.hostname}/${entorno.PGDATABASE}...`)
// --format=custom: comprimido, y pg_restore puede restaurar todo o una tabla sola.
const dump = spawnSync(pgDump, ['--format=custom', '--no-owner', '--no-privileges', `--file=${temporal}`], {
    env: entorno,
    stdio: ['ignore', 'inherit', 'inherit'],
})
if (dump.error || dump.status !== 0) {
    if (existsSync(temporal)) unlinkSync(temporal)
    console.error(dump.error?.code === 'ENOENT'
        ? 'No se encontró pg_dump. Instalá PostgreSQL o poné PG_BIN en el archivo de configuración.'
        : `pg_dump terminó con error (código ${dump.status}).`)
    process.exit(1)
}

// Comprobación: pg_restore --list lee el índice del archivo. Si está roto, falla.
const lista = spawnSync(pgRestore, ['--list', temporal], { encoding: 'utf8' })
if (lista.status !== 0 || !lista.stdout.includes('TABLE DATA')) {
    console.error('El backup se generó pero no se puede leer: no se guarda.')
    unlinkSync(temporal)
    process.exit(1)
}
renameSync(temporal, destino)
const tablas = lista.stdout.split('\n').filter((l) => l.includes('TABLE DATA')).length
console.log(`Listo: ${destino} (${(statSync(destino).size / 1024 / 1024).toFixed(1)} MB, ${tablas} tablas con datos)`)

// Rotación: se quedan los `conservar` más nuevos (el nombre ordena por fecha).
const viejos = readdirSync(carpeta)
    .filter((f) => /^nubio-.*\.dump$/.test(f))
    .sort()
    .reverse()
    .slice(conservar)
for (const f of viejos) {
    unlinkSync(join(carpeta, f))
    console.log(`Borrado por antiguo: ${f}`)
}
