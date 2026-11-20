# Nubio API — Backend

## Qué es este proyecto
Backend (Node + Express) de Nubio, una app de vigilancia de marcas. El frontend vive en un repositorio separado llamado `nubio`, desplegado en Render como Static Site. Este backend se despliega en Render como Web Service, en `https://nubio-api.onrender.com`.

## Stack
- Node.js + Express (ESM — `"type": "module"` en package.json)
- Knex como query builder, cliente `pg`, apuntando a Postgres
- bcrypt para hashear contraseñas
- dotenv para cargar variables de entorno en desarrollo

## Base de datos: Postgres
- Producción: Neon (free tier — 0.5GB, auto-suspende tras 5 min de inactividad).
- Desarrollo local: Postgres local, base `nubio`.
- La conexión SIEMPRE se arma a partir de `process.env.DATABASE_URL` (nunca hardcodear host/user/password — ya pasamos por ese bug en producción una vez).
- `db.js` (`crearDb()`) es la ÚNICA configuración de la conexión: la usan `server.js` y los scripts. No armar `knex({...})` a mano en otro lado. También fija el parser de DATE (ver abajo).
- TLS hacia Neon (cuando el hostname termina en `neon.tech`) con `rejectUnauthorized: true`: verifica el certificado y el host, no solo cifra. Si alguna vez falla con un error de certificado, no volver a poner `false`: investigar la causa.
- Parámetros `ssl*` en la URL: `pg` deja que la URL pise el `ssl` de la config. Con Neon, `db.js`:
  - corta el arranque si la URL pide algo inseguro: `sslmode=no-verify` o `disable`, o `ssl=0`/`false`;
  - saca de la URL cualquier otro parámetro que empiece con `ssl` (`sslmode`, `ssl`, `sslcert`, `sslkey`, `sslrootcert`…) y también `uselibpqcompat`. Así siempre manda nuestro `rejectUnauthorized: true`. B4 de la tercera revisión: antes solo se miraba `sslmode`. Importa porque `pg` 9 va a cambiar `require` a "cifrar sin verificar"; con esto, actualizar `pg` no nos quita la verificación. Tests en `tests/db.test.js`.
- `npm run probar-conexion` prueba la conexión con esa misma config y lo comprueba de verdad, mirando el socket de Node: `encrypted` (va cifrada) y `authorized` (verificó el certificado y el host). Con Neon, si no está verificado, termina con error. También chequea que exista la intercalación `es-x-icu`.
  - `pg_stat_ssl` se muestra solo como dato. La URL de producción usa el **pooler** de Neon (host `-pooler`, PgBouncer), y entonces Postgres informa SU conexión con el pooler, que es interna y va sin TLS, no la nuestra. Da "sin TLS" aunque nuestro tramo esté bien. Por eso no sirve para decidir.
  - Contra Neon, sin tocar el `.env`: en Git Bash, `DATABASE_URL="postgresql://...neon.tech/..." npm run probar-conexion`. En PowerShell, `$env:DATABASE_URL = "..."`, después `npm run probar-conexion` y al final `Remove-Item Env:DATABASE_URL`, para no dejar la terminal apuntando a producción.
- Sintaxis SQL específica de Postgres (ej: `TRUNCATE TABLE nombre RESTART IDENTITY;`).
- Cambios de esquema: se guardan como scripts numerados en `sql/` (`001_marcas.sql`, …) y se corren a mano en local y en el SQL Editor de Neon. Todavía no usamos migraciones de Knex.

### Tablas
- `login` (id, hash, email).
- `users` (id, name, email, joined). La columna `marcas` (contador) se eliminó: la cantidad de marcas sale de un `COUNT` sobre la tabla `marcas`. Falta agregar `avatar_url`.
- `marcas` (creada con `sql/001_marcas.sql`):
  - `id` SERIAL PK
  - `user_id` INTEGER NOT NULL → `users(id)` ON DELETE CASCADE
  - `fecha_solicitud` DATE NOT NULL
  - `expediente` TEXT NOT NULL, CHECK solo dígitos. Es TEXT a propósito, para conservar ceros a la izquierda.
  - `clase_niza` SMALLINT NOT NULL, CHECK 1..45
  - `denominacion` TEXT, nullable
  - `signo` CHAR(1) NOT NULL, CHECK `marcas_signo_valido`: M (Mixta), D (Denominativa), F (Figurativa), T (Tridimensional), S (Sonora). T y S se agregaron con `sql/004_signos_tridimensional_sonora.sql`; las letras están confirmadas en el buscador de DINAPI.
  - `titular` TEXT NOT NULL
  - `pais` CHAR(2) NOT NULL, código ISO 3166-1 alfa-2, más dos códigos propios de DINAPI: `XX` (sin especificar) y `EP` (Unión Europea).
  - `created_at` TIMESTAMPTZ NOT NULL DEFAULT now()
  - CHECK `marcas_denominacion_obligatoria`: solo F, T y S pueden no tener denominación (`SIGNOS_SIN_TEXTO`).
  - UNIQUE (user_id, pais, expediente): evita duplicados, y su índice también cubre las consultas por `user_id`.

- `boletin_marcas` (creada con `sql/002_boletin_marcas.sql`): marcas publicadas en los boletines de DINAPI. Son públicas, sin `user_id`.
  - Mismas columnas que `marcas` donde significan lo mismo (`expediente`, `clase_niza`, `denominacion`, `signo`, `titular`, `pais`), mismos CHECK.
  - `fecha_publicacion` DATE (fecha del boletín), `agente`, `matricula`, `tramite` ('Registro de Marcas' / 'Renovación de Marcas'), `referencia` (registro anterior, solo en renovaciones).
  - UNIQUE (fecha_publicacion, expediente): permite re-importar un boletín sin duplicar.
  - Se carga con `npm run importar-boletin -- <archivo.csv>` (`scripts/importar-boletin.js`). Los CSV quedan versionados en `data/boletines/aaaa-mm-dd.csv`, uno por día hábil. Formato: 11 columnas, Denominación y Solicitante URL-encoded, Agente entre comillas si tiene coma (se parsea con `utils/csv.js`, no con split), UTF-8 con BOM. El importador traduce `UK` → `GB`. Para producción, correr el script con `DATABASE_URL` de Neon. Al terminar, genera las alertas de ese boletín.
  - DINAPI publica dos formatos: el **diario** (`boletin_marcas_principales_aaaa-mm-dd.csv`, ya en nuestro formato: solo renombrar) y el **reporte semanal** "Marcas Recibidas" (5 líneas de encabezado, fechas dd/mm/aaaa, texto plano, signo en letra, matrícula con punto). El semanal se pasa a diarios con `npm run convertir-boletin-semanal -- <reporte.csv> [carpeta]`, que no pisa archivos existentes.
  - **Preferir siempre el diario:** el semanal pasa por Excel, que convierte números en fechas ("595" → "17/08/1901") y puede borrar ceros a la izquierda. El conversor avisa cada caso con el valor probable (días desde 30/12/1899); verificarlo en el buscador de DINAPI y corregir el CSV a mano antes de importar.
  - Ventana cargada: boletines de los últimos ~4 meses (60 días hábiles de oposición ≈ 85-90 corridos, más margen por feriados y por el desfase con la publicación en el diario).

- `alertas` (creada con `sql/003_alertas.sql`): posible conflicto entre una marca de un usuario y una del boletín.
  - `marca_id` → `marcas(id)` y `boletin_marca_id` → `boletin_marcas(id)`, ambas ON DELETE CASCADE. No hay `user_id`: el dueño sale de `marcas.user_id` con JOIN.
  - `score` (0-100), `nivel` ('alta' | 'media'), `motivos` TEXT[], `relacion_clase` ('misma' | 'relacionada' | 'otra'): los calcula el motor.
  - `estado` ('nueva' | 'en_revision' | 'a_oponer' | 'descartada', default 'nueva') y `nota`: los cambia el usuario.
  - UNIQUE (marca_id, boletin_marca_id): regenerar no duplica ni pisa estado/nota.

## Motor de similitud y alertas
- `utils/similitud/`: funciones puras (sin DB), con tests en `tests/`. `compararMarcas(mia, ajena)` → `{ score, nivel, motivos, relacionClase }`.
  - Normaliza (mayúsculas, sin acentos, sin puso ni tildes nasales del guaraní) y quita términos genéricos (`terminosGenericos.js`).
  - Señales: parecido ortográfico (promedio Jaro-Winkler + Levenshtein), fonético (doble clave: lectura española y guaraní, se queda con la mejor), cobertura por palabra (elemento dominante, con piso 0.75) y contención. Toma la más fuerte.
  - Clase Niza: pondera, no filtra (Ley 1294/98, art. 15). Misma +5, relacionada 0 (`clasesRelacionadas.js`), otra −15; con base ≥ 95 no se resta (posible notoria, art. 2 inc. g).
  - Umbral de alerta 70; alta ≥ 85.
  - Rendimiento: `prepararMarca(m)` normaliza y saca las claves fonéticas una sola vez, y `compararPreparadas(a, b)` compara marcas ya preparadas. `compararMarcas` es el atajo para comparar un par suelto. Para muchos contra muchos, preparar siempre antes: si no, cada marca del boletín se vuelve a procesar una vez por cada marca propia. `lev` y `jaro` reusan buffers (typed arrays). En noviembre de 2026 se midió que el resultado es idéntico en 658.950 pares reales y 10 veces más rápido: ~155 ms por marca contra ~9000 publicadas. Si se toca el motor, repetir esa comparación viejo contra nuevo.
- `utils/plazos.js` + `utils/feriados.js`: plazo de oposición = 60 días hábiles desde el primer día hábil siguiente a la publicación (art. 46). Es ESTIMADO: usamos la fecha del boletín, no la de la última publicación en el diario. Feriados trasladables: cargarlos a mano en `AJUSTES` cada año. `venceOposicion` guarda en memoria el resultado de cada fecha (hay miles de marcas pero pocas fechas), así que cambiar feriados requiere reiniciar el servidor (un deploy lo hace).
- `services/alertas.js`: genera e inserta alertas. Excluye figurativas, renovaciones y el mismo expediente (la propia solicitud).
  - El motor cede el turno cada 20 ms (`setImmediate`) para no congelar la API: Node tiene un solo hilo. Inserta en tandas de 1000 (límite de parámetros de Postgres).
  - `generarAlertasParaBoletin(db, fecha)`: un boletín contra todas las marcas. Lo llama el importador.
  - `generarAlertasParaMarcas(db, ids)`: marcas nuevas contra lo publicado con plazo abierto. El servidor NUNCA la llama directo: siempre a través de la fila.
  - `encolarAlertasParaMarcas(db, ids)`: la fila de trabajos en segundo plano. Procesa de a uno, así nunca hay dos motores ni dos copias de las publicaciones en memoria. La usan `POST /marcas` y `/marcas/bulk`, y ninguno espera: con la fila libre, las alertas de una marca están en menos de un segundo. La fila vive en memoria: si el servidor se reinicia a mitad de un trabajo, esas alertas se recuperan con `npm run recalcular-alertas`.
  - Tope de la fila: `MAX_MARCAS_EN_COLA` = 5000 marcas pendientes (unos 13 min de CPU). Se cuenta en marcas y no en trabajos, porque uno de 1000 pesa 1000 veces más que uno de 1. Además, `MAX_MARCAS_EN_COLA_POR_USUARIO` = 1000 (lo que entra en una importación): una cuenta no puede llenar la fila sola y dejar a las demás con 503 (M4 de la tercera revisión). Los controladores preguntan `faltaLugarEnCola(userId, n)` ANTES de insertar. Si devuelve `'usuario'` (sus alertas todavía se generan) o `'servidor'` (fila llena), responden 503 con `Retry-After`. Así no quedan marcas guardadas sin alertas. `encolarAlertasParaMarcas(db, ids, userId)` suma y, en el `finally`, resta del contador global y del de ese usuario. Antes del tope, una cuenta podía encolar horas de CPU y las alertas de los demás no llegaban nunca (hallazgo N1 de la segunda revisión de Case).
  - Caché de lo publicado en plazo, ya preparado (`publicadasEnPlazo`): traer y preparar las ~9000 publicaciones cuesta ~300 ms. La clave es día + id máximo + cantidad de `boletin_marcas` en la ventana: el importador corre en otro proceso y no puede avisar, así que cada trabajo compara la clave (una consulta barata). Medido: 367 ms el primer trabajo de una marca, 92 ms los siguientes.
- `npm run recalcular-alertas`: vuelve a correr el motor sobre todos los boletines (solo agrega). Usarlo después de ajustar el motor. Las alertas viejas que el motor nuevo ya no generaría NO se borran.
- `npm test`: tests con `node:test` (sin dependencias).
- `npm run dev`: servidor local con `--watch` (se reinicia al guardar). `npm start` es para producción (`node server.js`, sin `--watch`).

### Detalles en server.js
- `pg.types.setTypeParser(1082, v => v)` (en `db.js`): las columnas DATE se devuelven como string `"aaaa-mm-dd"` y no como `Date` de JS. Así se evitan corrimientos de día por zona horaria.
- `express.json({ limit: '1mb' })`: el default de 100kb no alcanzaba para importaciones grandes.
- Justo después de `express.json`, un middleware deja `req.body ??= {}`. En Express 5, un pedido sin `Content-Type: application/json` deja `req.body` en `undefined` y `req.body.algo` daba 500. Con el objeto vacío, los controladores validan y responden 400.
- Al final de todas las rutas van `rutaNoEncontrada` (404 JSON) y `manejarErrores` (`middleware/errores.js`). JSON mal formado → 400, body de más de 1 MB → 413, cualquier otro → 500 genérico. La API responde siempre JSON y nunca manda stack traces, sea cual sea `NODE_ENV`. Antes, un JSON mal formado devolvía una página HTML con el stack completo.

## Autenticación (JWT)
- `POST /signin` devuelve `{ token, user }`. El token es un JWT HS256 firmado con `JWT_SECRET`, con `sub` = id del usuario, que vence a las 8 horas (`utils/token.js`). El payload no está cifrado: no poner datos sensibles.
- `JWT_SECRET` es obligatorio (mínimo 32 caracteres) y el servidor no arranca sin él. En local va en `.env`; en Render, en el dashboard, con un valor distinto. Generarlo con `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`. Cambiarlo invalida todas las sesiones abiertas.
- `middleware/requireAuth.js` lee `Authorization: Bearer <token>`. Si es válido, pone `req.userId` y sigue. Si no, responde 401 `{ error }`.
- **Regla:** toda ruta que maneje datos lleva `requireAuth`, y los controladores toman el usuario SOLO de `req.userId`. Nunca de `req.body.user_id` ni de `req.query.user_id`: si el cliente los manda, se ignoran.
- Públicas: `GET /`, `POST /signin`, `POST /register`. Todo lo demás está protegido.
- Rate limiting (`middleware/rateLimit.js`, `express-rate-limit`, contadores en memoria). Responde 429 `{ error }`:
  - `/signin`: 10 intentos FALLIDOS cada 15 min por IP (los exitosos no cuentan).
  - `/signin`, además, por CUENTA (`utils/intentosPorCuenta.js`, dentro del controlador): frena a quien reparte intentos entre muchas IPs contra un mismo email.
    - Cuenta los fallos de la última hora por email, de cualquier IP. Los primeros 10 son libres; después hay que esperar 1, 2, 4… segundos entre intentos, con techo de 60 s, y si no se espera da 429 con `Retry-After`. Un login correcto borra el contador.
    - Es demora y no bloqueo a propósito: un bloqueo serviría para dejar afuera a la víctima. El atacante queda en ~60 intentos por hora por cuenta.
    - IPs conocidas (M2 de la tercera revisión): desde una IP donde ese email ya inició sesión en los últimos 30 días no hay demora. Sin esto, un atacante con un intento por minuto tenía a la víctima siempre esperando. Desde esas IPs sigue valiendo el límite por IP. Una víctima que entra desde una IP nueva mientras la atacan todavía puede tener que esperar (hasta 60 s por intento).
    - El intento se reserva con `registrarIntento` ANTES de bcrypt, y `registrarExito` lo borra si sale bien. Antes se registraba después, y los pedidos en paralelo pasaban todos el chequeo (M3). Medido: de 30 intentos simultáneos desde 30 IPs pasan 10 y 20 reciben 429. Si la base falla en el medio, el intento queda contado como fallo.
    - Antes de contar, el login exige un email válido (`validarEmail`: formato y máximo 254) y una contraseña de hasta 1024 caracteres (A1: un "email" de 1 MB llenaba la memoria).
    - Las claves en memoria son SHA-256 del email (o de email|IP): largo fijo y sin emails guardados. Hasta 50.000 entradas por tabla; las más viejas se descartan. Un `setInterval` con `.unref()` barre las vencidas cada 10 minutos.
    - Cuenta también emails inexistentes, con el mismo mensaje, para no revelar qué cuentas existen.
    - Se chequea antes de bcrypt (los intentos frenados no gastan CPU).
    - Tests en `tests/intentosPorCuenta.test.js`.
  - `/register`: 5 cada hora por IP.
  - `/marcas/bulk`: 10 importaciones por hora por USUARIO (`keyGenerator` con `req.userId`). Va después de `requireAuth` en la ruta, porque necesita `req.userId`.
  - Toda la API: 500 cada 15 min por IP.
  - `cors()` va antes del limitador general, para que el 429 lleve headers CORS y el frontend pueda leer el mensaje.
  - `app.set('trust proxy', 3)`: en Render hay 3 proxies (Cloudflare → balanceador de Render → proxy local), medido en noviembre de 2026. Con 1, todos los usuarios compartían la IP del balanceador y el límite los bloqueaba a todos juntos. Se puede pisar con la variable `TRUST_PROXY`. Nunca `true` ni un número mayor: el cliente podría inventar IPs y saltarse el límite.
  - Para volver a medir si Render cambia: endpoint temporal que devuelva `req.ip`, `x-forwarded-for` y `cf-connecting-ip`. `TRUST_PROXY` es la cantidad de IPs que hay a la derecha de la del cliente en `x-forwarded-for`, más 1 por el proxy local (socket `::1`). Comprobar que `req.ip` coincida con `cf-connecting-ip`. Borrar el endpoint después.
- Tests: `tests/token.test.js` (token modificado, otro secreto, `alg: none`, vencido, middleware).

## Rutas existentes
- `POST /register` — valida con `validarRegistro` → `revisarFiltrada` → hashea con bcrypt (`COSTO_BCRYPT` = 12) → inserta en `login` y `users` en una transacción → 200 con el usuario. 400 `{ error, errores }` si no valida; 400 `{ error }` genérico si el email ya existe. No devuelve token: el usuario después inicia sesión.
- `POST /signin` — normaliza el email, compara con bcrypt y devuelve `{ token, user }` (user con columnas explícitas: id, name, email, joined). Cualquier falla da 400 con el mismo mensaje (`Usuario o contraseña incorrectos.`). Si el email no existe, compara igual contra un hash de relleno, para que la respuesta tarde lo mismo y no se pueda averiguar qué emails están registrados midiendo tiempos. Medido: 167 ms en los dos casos.
- `GET /me` — el usuario logueado (sale del token). Reemplazó a `GET /profile/:id`, que devolvía cualquier usuario por id.

### Marcas (`controllers/marcas.js`)
- `GET /marcas` — array de marcas del usuario, ordenadas por `fecha_solicitud` desc.
- `POST /marcas` con `{ ...marca }`:
  - 201 con la marca creada.
  - 400 `{ error, errores }` si no valida.
  - 409 si ya existe (mismo user_id + pais + expediente, código Postgres 23505).
  - 400 si el usuario no existe (23503).
  - 400 si pasaría el tope de marcas por usuario; 503 si la fila de alertas está llena (ver abajo).
- `POST /marcas/bulk` con `{ marcas: [...] }`:
  - Devuelve `{ insertadas: n, errores: [{ fila, error }] }`. `fila` es el índice (desde 0) en el array recibido; el frontend lo traduce a número de fila del archivo.
  - Máximo 1000 marcas por request.
  - 400 si pasaría el tope de marcas por usuario; 503 si la fila de alertas está llena; 429 después de 10 importaciones en una hora.
- Tope de marcas por usuario: `MAX_MARCAS_POR_USUARIO` = 5000 (un `COUNT` antes de insertar). Protege la CPU del motor y el disco de Neon (0,5 GB). Si un cliente real necesita más, subirlo. Tests en `tests/capacidad.test.js`.
  - Valida todo primero y hace un único INSERT con `ON CONFLICT DO NOTHING`. Las filas que no vuelven en `returning` se reportan como duplicadas.

### Boletines DINAPI (`controllers/boletines.js`)
- `GET /boletines/marcas` — paginado: el servidor filtra, ordena y pagina. Antes devolvía las 13.000+ marcas (~3 MB) y filtraba el navegador; ahora son ~6 KB por página (hallazgo N9 de Case).
  - Query: `pagina` (default 1), `porPagina` (1-100, default 20), `orden` (lista blanca `ORDEN`, default `fecha_publicacion`), `direccion` (`asc`|`desc`, default `desc`) y `filtros` (JSON `[{ campo, valor }]` o `[{ campo, desde, hasta }]` para fechas). Cualquier cosa fuera de las listas blancas da 400. `parsearConsulta` valida todo; tests en `tests/boletines.test.js`.
    - `campo`, `orden` y `filtros` tienen que ser texto (`typeof === 'string'`) antes de buscarse en las listas blancas. `Object.hasOwn` convierte la clave a texto, y un array como `["pais"]` (o `?orden=a&orden=b`) pasaba y daba 500 (B1 de la tercera revisión).
    - Las fechas tienen que existir (`esFechaReal`: `2026-99-99` o `0000-01-01` dan 400), y la clase tiene que estar entre 1 y 45 (fuera de rango no coincide con nada, en vez de reventar el `smallint`).
    - Cada filtro se vuelve a armar con solo `campo` y `valor` (o `desde` y `hasta`): sigue adelante exactamente lo validado.
    - `LARGO_MAXIMO_VALOR` (200) es el `maxLength` del filtro de texto del frontend (`LARGO_MAXIMO_FILTRO` en `marcaFiltros.js`).
  - Respuesta: `{ marcas, total, totalGeneral, opciones: { pais, tramite } }`. `total` es lo que cumple los filtros; `opciones`, los valores que existen para los desplegables.
  - Los filtros replican `filtrarMarcas` del frontend. Texto: sin mayúsculas ni tildes (`translate()` + `lower()`, porque `unaccent` no está activada) y `%`/`_` escapados. Número: exacto. Opciones: igualdad. Fecha: rango. Se verificó contra la lógica del frontend en 10 combinaciones, con los mismos totales.
  - `FILTROS` y `ORDEN` tienen que coincidir con `CAMPOS_FILTRO_BOLETIN` y las columnas de `BoletinesDinapi.jsx` del frontend.
  - El orden de texto usa la intercalación ICU `es-x-icu`, las mismas reglas que `Intl.Collator('es')` del navegador. Se verificó en las 13.213 filas: 0 diferencias, salvo números dentro del texto ("cafe 10" antes que "cafe 9"); igualarlo requiere una intercalación propia (`es-u-kn-true`) creada con un SQL. `probar-conexion` avisa si falta `es-x-icu`. Vacíos al final y desempate por `id`, para que una fila no cambie de página entre pedidos.

### Alertas (`controllers/alertas.js`)
- `GET /alertas` — filas planas: datos de la alerta, de mi marca (`mi_denominacion`, `mi_clase_niza`, `mi_expediente`) y de la marca del boletín (mismos nombres que en `/boletines/marcas`), más `vence_oposicion` y `dias_habiles_restantes` (negativo si venció). Orden: nuevas primero, después por score.
- `PATCH /alertas/:id` con `{ estado?, nota? }` — 200 `{ id, estado, nota }`; 400 si el estado es inválido o no hay cambios; 404 si la alerta no es de una marca del usuario.

## Validación de registro e inicio de sesión
- `utils/authValidation.js` es COPIA de `src/utils/authValidation.js` del frontend. Única diferencia: el comentario del encabezado.
- Valida tipos: si llega algo que no es texto, se trata como vacío. Email: `trim().toLowerCase()`, formato `algo@algo.algo`, máximo 254. Nombre: 1-100 (la columna es `varchar(100)`). La contraseña no se recorta.
- Política de contraseñas (noviembre 2026, recomendación de Case según NIST SP 800-63B-4 y OWASP ASVS 5.0):
  - Mínimo 15 caracteres reales: se cuentan con `contarCaracteres` (`[...texto].length`), no con `.length`, porque un emoji son 2 unidades UTF-16. NIST pide 15 cuando la contraseña es el único factor. Si algún día hay 2FA, se puede revisar.
  - Máximo 72 BYTES, porque bcrypt ignora en silencio lo que sigue (comprobado).
  - Sin reglas de composición (mayúscula, número, símbolo): NIST las prohíbe. Sin vencimiento periódico.
  - No puede contener `nubio`, `dinapi`, el nombre (palabras de 4+ letras) ni la parte del correo antes de la @. Se compara en minúsculas y sin tildes.
  - En el registro, además, `revisarFiltrada` (`utils/passwordFiltrada.js`) la rechaza si aparece en filtraciones. Primero mira `data/passwords-comunes.txt` (~11.000 contraseñas filtradas de 15+ caracteres, de SecLists xato-net 1M, MIT). Después consulta Have I Been Pwned por k-anonimato: viajan solo 5 caracteres del SHA-1, con `Add-Padding` y timeout de 2 s. Si HIBP no responde, deja pasar con lo que dijo la lista local; un servicio caído no bloquea el alta. Los tests usan un `fetch` falso y no salen a internet.
  - `/signin` NO aplica la política: quien tiene una contraseña vieja más corta sigue entrando. Los hashes de costo menor a `COSTO_BCRYPT` se recalculan en el login (es el único momento en que se tiene la contraseña). Mientras queden hashes de costo 10 sin migrar, un email existente responde algo más rápido que uno inexistente.
  - Login con costo 12: ~500 ms medido en local.
- En `/signin` NO se aplica el máximo de 72 bytes: quien se registró antes con una contraseña más larga sigue entrando, porque bcrypt la trunca igual al comparar.
- Emails siempre en minúsculas: CHECK en `login` y `users` (`sql/006_emails_en_minusculas.sql`).
- Tests en `tests/authValidation.test.js`. Incluyen signin con una base falsa en memoria.

## Validación de marcas
- `utils/marcaValidation.js` y `utils/paises.js` son COPIAS de `src/utils/marcaValidation.js` y `src/config/paises.js` del frontend (repo `nubio`). Única diferencia: el import usa `./paises.js`, porque Node ESM exige la extensión. Si cambia una regla, hay que cambiarla en los dos repos.
- `normalizarMarca` funciona también como whitelist de campos: el insert nunca recibe `req.body` directo, para evitar mass assignment.
- Expediente: solo dígitos, hasta `LARGO_MAXIMO_EXPEDIENTE` = 20 (los reales tienen 7 a 10). Uno muy largo superaba el tamaño máximo del índice UNIQUE y hacía fallar la importación entera. CHECK en `sql/007_largo_maximo_expediente.sql`.
- Topes de largo: `LARGO_MAXIMO_DENOMINACION` = 300 y `LARGO_MAXIMO_TITULAR` = 500. Los máximos reales en los boletines son 181 y 145. Protegen al motor de similitud: su costo es largo × largo, y sin tope un texto enorme congela el servidor. Están también como CHECK en `marcas` (`sql/005_largo_maximo_marcas.sql`), pero no en `boletin_marcas`, para no trabar la importación por un error de carga de DINAPI. Si cambian, hay que cambiarlos en los dos repos y en SQL. Tests en `tests/marcaValidation.test.js`.

## Convenciones importantes
- Todas las rutas responden errores como `{ error: 'mensaje' }`. Cuando hay errores por campo, agregan `errores: { campo: mensaje }`.
- Errores al log SIEMPRE con `registrarError(contexto, err)` (`utils/log.js`), nunca con `console.error(err)`. El objeto completo de `pg` trae `detail`, donde Postgres copia los datos de la fila: emails, titulares, `user_id`. El helper deja solo `code`, el nombre de la `constraint` y `message`. Knex le antepone la consulta al `message`, pero con pg va con `$1, $2…` y sin valores (verificado con errores reales). Los errores de tipo de dato (`22xxx`) repiten el valor rechazado en el mensaje ("el valor «99999» está fuera de rango"), así que para esos se omite el `message` (M1 de la tercera revisión). Tests en `tests/log.test.js`. Los scripts de `scripts/` pueden seguir usando `console.error(err)`: corren en la terminal del dueño, no en los logs de Render.
- Códigos de error de Postgres que se manejan: 23505 (unique) → 409, 23503 (foreign key) → 400.
- Headers de seguridad y CORS en `middleware/seguridad.js`. Orden en `server.js`: helmet → CORS → limitador general → `express.json`.
  - Helmet con la CSP más estricta (`default-src 'none'; frame-ancestors 'none'`), porque la API nunca sirve HTML. Además `X-Frame-Options: DENY`, HSTS y `nosniff`, y saca `X-Powered-By`.
  - CORS solo para los orígenes de `FRONTEND_URL`, con métodos GET/POST/PATCH, headers `Content-Type` y `Authorization`, sin credentials (el token va en un header, no en cookie) y preflight cacheado 10 min. Si se agrega un método (ej. DELETE) o un header, sumarlo acá o el navegador lo va a bloquear.
  - CORS no frena a curl ni a scripts: protege al usuario dentro de su navegador. La protección de la API son `requireAuth` y el rate limit.
- Variables de entorno vía `.env` local (gitignoreado) + `dotenv/config`; en producción, Render las inyecta directo en el dashboard. Obligatorias (el servidor no arranca sin ellas):
  - `DATABASE_URL`.
  - `JWT_SECRET`.
  - `FRONTEND_URL`: uno o varios orígenes separados por coma, sin barra final. En local `http://localhost:5173`; en Render, la URL del Static Site.
  - Opcional: `TRUST_PROXY` (default 3).
  - En Render también va `NODE_ENV=production`: Express y varias librerías apagan modos de depuración.
- Dependencias: correr `npm audit` en los dos repos antes de cada deploy. `npm audit fix` sin `--force` solo sube versiones compatibles. En noviembre de 2026 quedó en 0 vulnerabilidades. El `xlsx` del frontend viene del CDN de SheetJS y `npm audit` no lo ve: seguir sus releases a mano.
- Mensajes de commit: cortos, una línea, minúscula, sin punto final, en español.

## Pendiente (backlog activo)
- Agregar columna `avatar_url` a `users`.
- Endpoint para actualizar perfil (nombre + foto).
- Endpoint para cambiar contraseña (requiere verificar la contraseña actual contra `login`).
- Roles y permisos: admin vs usuario regular.
- Seguridad, tercera revisión de Case (noviembre 2026). Ya resueltos: A1, M1 a M4, B1, B4, B5, B6 y el `maxLength` del filtro. Faltan, en orden:
  - B2: `/boletines/marcas` hace 5 consultas por pedido y el pool de knex tiene 10 conexiones. Caché de `totalGeneral` y `opciones`, `statement_timeout` y un limitador por usuario.
  - B3: varios bulk en paralelo pueden pasar el chequeo de capacidad antes de encolar (hay un `await COUNT` en el medio). Reservar el lugar en la fila de forma síncrona; el tope por usuario, con una transacción y `pg_advisory_xact_lock(userId)`.
  - Registrar eventos de seguridad (logins fallidos, 429 por cuenta, registros) con hash del email e IP.
  - A decidir: los términos buscados en Boletines viajan en el query string y pueden quedar en los logs de Render/Cloudflare. Son datos públicos, pero revelan qué investiga el estudio (alternativa: pasar a POST).
- Seguridad, de la segunda revisión de Case falta:
  - I3: el JWT no se puede revocar. Con los roles y la baja de usuarios, `requireAuth` tiene que verificar que el usuario siga activo (o usar `token_version`).
- Contraseñas, lo que falta de la política recomendada por Case (noviembre 2026), para cuando se hagan el cambio de contraseña, los roles y la invitación de usuarios:
  - Endpoint de cambio de contraseña con las mismas reglas + `revisarFiltrada`, verificando la actual.
  - Cambio obligatorio para quien tenga una contraseña que no cumpla la política: en `/signin`, después de validar, marcar `debe_cambiar_password` (columna nueva) y dejar ir solo a la pantalla de cambio. No bloquear a nadie de golpe.
  - Cuentas creadas por admin con link de invitación (token de un solo uso, guardado como hash, vence en 24-72 h): el admin nunca elige la contraseña de otro.
  - Normalizar con `password.normalize('NFKC')` antes de hashear y comparar (en signin, probar normalizada y si falla la cruda, y re-hashear).
  - Migrar a argon2id (OWASP: m=19 MiB, t=2, p=1) con re-hash en el login por prefijo del hash (`$2b$` = bcrypt). Con argon2, tope de bytes también en `/signin`.
  - 2FA con TOTP: obligatorio para admin, recomendado para todos. Códigos de recuperación hasheados, secreto cifrado, rate limit en el paso del código.
  - Frontend: botón para mostrar u ocultar la contraseña.
- Seguridad, lo que queda de la primera revisión de Case (noviembre 2026):
  - Rol de Postgres de mínimo privilegio para la app en Neon (solo SELECT/INSERT/UPDATE/DELETE sobre sus tablas). El owner se usa solo para correr los `sql/00X_*.sql`.
  - Historial de cambios de alertas (`alertas_historial`: quién, de qué estado a cuál, cuándo), en la misma transacción del PATCH. Importa porque las alertas sostienen decisiones legales con plazo.
  - Con los roles: `/register` solo para admin (hoy cualquiera puede crear una cuenta).
  - Si hay dominio propio: pasar el token a cookie HttpOnly (hoy va en localStorage porque frontend y API están en subdominios distintos de onrender.com y Safari bloquea esas cookies).
- Mantener sincronizadas las copias de validación (`utils/marcaValidation.js`, `utils/paises.js`, `utils/authValidation.js`) con el frontend.
- Correr `sql/003_alertas.sql` en Neon antes de deployar el backend con alertas.
- Validar con el abogado (el motor todavía no se probó con un especialista):
  - lista de clases relacionadas (`clasesRelacionadas.js`) y si la clase 35 se relaciona con todos los productos;
  - términos genéricos y descriptivos por rubro (`terminosGenericos.js`), ej: CAFE en clase 30;
  - umbrales (70 / 85) y ajustes por clase;
  - si las renovaciones deben quedar excluidas;
  - cómputo del plazo: fecha del boletín vs. última publicación en el diario;
  - criterios de las Directrices de Examen de Marcas DINAPI (Res. 259/2025), sección derechos de terceros.
- Cargar los feriados trasladables del año en `utils/feriados.js`. 2026: Boquerón trasladado al 28/09, deducido de los boletines (falta confirmar con el decreto); 1/3 y 12/6 sin revisar.

## Cómo ayudar en este proyecto
El dueño de este proyecto está aprendiendo Express, Postgres, Git y deployment en profundidad mientras lo construye. Preferencia explícita: explicar el porqué de cada cambio, no solo tirar código.