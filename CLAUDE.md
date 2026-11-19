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
- La conexión SIEMPRE se arma a partir de `process.env.DATABASE_URL` (nunca hardcodear host/user/password — ya pasamos por ese bug en producción una vez). SSL se activa condicionalmente cuando la URL contiene `neon.tech`.
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
- `utils/plazos.js` + `utils/feriados.js`: plazo de oposición = 60 días hábiles desde el primer día hábil siguiente a la publicación (art. 46). Es ESTIMADO: usamos la fecha del boletín, no la de la última publicación en el diario. Feriados trasladables: cargarlos a mano en `AJUSTES` cada año.
- `services/alertas.js`: genera e inserta alertas. Excluye figurativas, renovaciones y el mismo expediente (la propia solicitud).
  - `generarAlertasParaBoletin(db, fecha)`: un boletín contra todas las marcas. Lo llama el importador.
  - `generarAlertasParaMarcas(db, ids)`: marcas nuevas contra lo publicado con plazo abierto. Lo llaman `POST /marcas` y `/marcas/bulk` (si falla, se loguea y no rompe la creación).
- `npm run recalcular-alertas`: vuelve a correr el motor sobre todos los boletines (solo agrega). Usarlo después de ajustar el motor. Las alertas viejas que el motor nuevo ya no generaría NO se borran.
- `npm test`: tests con `node:test` (sin dependencias).

### Detalles en server.js
- `pg.types.setTypeParser(1082, v => v)`: las columnas DATE se devuelven como string `"aaaa-mm-dd"` y no como `Date` de JS. Así se evitan corrimientos de día por zona horaria.
- `express.json({ limit: '1mb' })`: el default de 100kb no alcanzaba para importaciones grandes.

## Autenticación (JWT)
- `POST /signin` devuelve `{ token, user }`. El token es un JWT HS256 firmado con `JWT_SECRET`, con `sub` = id del usuario, que vence a las 8 horas (`utils/token.js`). El payload no está cifrado: no poner datos sensibles.
- `JWT_SECRET` es obligatorio (mínimo 32 caracteres) y el servidor no arranca sin él. En local va en `.env`; en Render, en el dashboard, con un valor distinto. Generarlo con `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`. Cambiarlo invalida todas las sesiones abiertas.
- `middleware/requireAuth.js` lee `Authorization: Bearer <token>`. Si es válido, pone `req.userId` y sigue. Si no, responde 401 `{ error }`.
- **Regla:** toda ruta que maneje datos lleva `requireAuth`, y los controladores toman el usuario SOLO de `req.userId`. Nunca de `req.body.user_id` ni de `req.query.user_id`: si el cliente los manda, se ignoran.
- Públicas: `GET /`, `POST /signin`, `POST /register`. Todo lo demás está protegido.
- Rate limiting (`middleware/rateLimit.js`, `express-rate-limit`, por IP, contadores en memoria). Responde 429 `{ error }`:
  - `/signin`: 10 intentos FALLIDOS cada 15 min (los exitosos no cuentan).
  - `/register`: 5 cada hora.
  - Toda la API: 500 cada 15 min.
  - `cors()` va antes del limitador general, para que el 429 lleve headers CORS y el frontend pueda leer el mensaje.
  - `app.set('trust proxy', 3)`: en Render hay 3 proxies (Cloudflare → balanceador de Render → proxy local), medido en noviembre de 2026. Con 1, todos los usuarios compartían la IP del balanceador y el límite los bloqueaba a todos juntos. Se puede pisar con la variable `TRUST_PROXY`. Nunca `true` ni un número mayor: el cliente podría inventar IPs y saltarse el límite.
  - Para volver a medir si Render cambia: endpoint temporal que devuelva `req.ip`, `x-forwarded-for` y `cf-connecting-ip`. `TRUST_PROXY` es la cantidad de IPs que hay a la derecha de la del cliente en `x-forwarded-for`, más 1 por el proxy local (socket `::1`). Comprobar que `req.ip` coincida con `cf-connecting-ip`. Borrar el endpoint después.
- Tests: `tests/token.test.js` (token modificado, otro secreto, `alg: none`, vencido, middleware).

## Rutas existentes
- `POST /register` — valida campos + longitud de contraseña (mínimo 10) → hashea con bcrypt → inserta en `login` y `users` en una transacción. No devuelve token: el usuario después inicia sesión.
- `POST /signin` — busca email en `login`, compara hash con bcrypt, devuelve `{ token, user }` (user con columnas explícitas: id, name, email, joined).
- `GET /me` — el usuario logueado (sale del token). Reemplazó a `GET /profile/:id`, que devolvía cualquier usuario por id.

### Marcas (`controllers/marcas.js`)
- `GET /marcas` — array de marcas del usuario, ordenadas por `fecha_solicitud` desc.
- `POST /marcas` con `{ ...marca }`:
  - 201 con la marca creada.
  - 400 `{ error, errores }` si no valida.
  - 409 si ya existe (mismo user_id + pais + expediente, código Postgres 23505).
  - 400 si el usuario no existe (23503).
- `POST /marcas/bulk` con `{ marcas: [...] }`:
  - Devuelve `{ insertadas: n, errores: [{ fila, error }] }`. `fila` es el índice (desde 0) en el array recibido; el frontend lo traduce a número de fila del archivo.
  - Máximo 1000 marcas por request.
  - Valida todo primero y hace un único INSERT con `ON CONFLICT DO NOTHING`. Las filas que no vuelven en `returning` se reportan como duplicadas.

### Boletines DINAPI (`controllers/boletines.js`)
- `GET /boletines/marcas` — todas las marcas del boletín, ordenadas por `fecha_publicacion` desc y `expediente`. Sin paginar todavía (se filtra en el frontend).

### Alertas (`controllers/alertas.js`)
- `GET /alertas` — filas planas: datos de la alerta, de mi marca (`mi_denominacion`, `mi_clase_niza`, `mi_expediente`) y de la marca del boletín (mismos nombres que en `/boletines/marcas`), más `vence_oposicion` y `dias_habiles_restantes` (negativo si venció). Orden: nuevas primero, después por score.
- `PATCH /alertas/:id` con `{ estado?, nota? }` — 200 `{ id, estado, nota }`; 400 si el estado es inválido o no hay cambios; 404 si la alerta no es de una marca del usuario.

## Validación de marcas
- `utils/marcaValidation.js` y `utils/paises.js` son COPIAS de `src/utils/marcaValidation.js` y `src/config/paises.js` del frontend (repo `nubio`). Única diferencia: el import usa `./paises.js`, porque Node ESM exige la extensión. Si cambia una regla, hay que cambiarla en los dos repos.
- `normalizarMarca` funciona también como whitelist de campos: el insert nunca recibe `req.body` directo, para evitar mass assignment.
- Topes de largo: `LARGO_MAXIMO_DENOMINACION` = 300 y `LARGO_MAXIMO_TITULAR` = 500. Los máximos reales en los boletines son 181 y 145. Protegen al motor de similitud: su costo es largo × largo, y sin tope un texto enorme congela el servidor. Están también como CHECK en `marcas` (`sql/005_largo_maximo_marcas.sql`), pero no en `boletin_marcas`, para no trabar la importación por un error de carga de DINAPI. Si cambian, hay que cambiarlos en los dos repos y en SQL. Tests en `tests/marcaValidation.test.js`.

## Convenciones importantes
- Las rutas de marcas responden errores como `{ error: 'mensaje' }`. `requireAuth` y `/me` también. Las rutas `/signin` y `/register` todavía devuelven strings sueltos; está pendiente unificarlas.
- Códigos de error de Postgres que se manejan: 23505 (unique) → 409, 23503 (foreign key) → 400.
- `cors()` está sin restricciones todavía — pendiente restringirlo al dominio real del frontend en Render.
- Variables de entorno vía `.env` local (gitignoreado) + `dotenv/config`; en producción, Render las inyecta directo en el dashboard.
- Mensajes de commit: cortos, una línea, minúscula, sin punto final, en español.

## Pendiente (backlog activo)
- Agregar columna `avatar_url` a `users`.
- Endpoint para actualizar perfil (nombre + foto).
- Endpoint para cambiar contraseña (requiere verificar la contraseña actual contra `login`).
- Restringir CORS al dominio real del frontend.
- Roles y permisos: admin vs usuario regular.
- Seguridad, resto del plan de la revisión de Case (noviembre 2026), en orden:
  - Correr `sql/005_largo_maximo_marcas.sql` en Neon.
  - Sacar la generación de alertas del request: un `/marcas/bulk` de 1000 marcas compara 1000 × miles de marcas del boletín de forma síncrona y bloquea la API para todos mientras dura.
  - Validar `/register` y `/signin` con un esquema (tipos, email normalizado, password 10-128).
  - `helmet()`, CORS restringido, `rejectUnauthorized: true` hacia Neon, error handler central, `NODE_ENV=production` y `start` sin `--watch`.
  - Si hay dominio propio: pasar el token a cookie HttpOnly (hoy va en localStorage porque frontend y API están en subdominios distintos de onrender.com y Safari bloquea esas cookies).
- Unificar el formato de errores de `/signin` y `/register` a `{ error }`.
- Mantener sincronizadas las copias de validación (`utils/`) con el frontend.
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