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
  - `signo` CHAR(1) NOT NULL, CHECK IN ('M', 'D', 'F')
  - `titular` TEXT NOT NULL
  - `pais` CHAR(2) NOT NULL, código ISO 3166-1 alfa-2
  - `created_at` TIMESTAMPTZ NOT NULL DEFAULT now()
  - CHECK (signo = 'F' OR denominación no vacía): solo las figurativas pueden no tener denominación.
  - UNIQUE (user_id, pais, expediente): evita duplicados, y su índice también cubre las consultas por `user_id`.

- `boletin_marcas` (creada con `sql/002_boletin_marcas.sql`): marcas publicadas en los boletines de DINAPI. Son públicas, sin `user_id`.
  - Mismas columnas que `marcas` donde significan lo mismo (`expediente`, `clase_niza`, `denominacion`, `signo`, `titular`, `pais`), mismos CHECK.
  - `fecha_publicacion` DATE (fecha del boletín), `agente`, `matricula`, `tramite` ('Registro de Marcas' / 'Renovación de Marcas'), `referencia` (registro anterior, solo en renovaciones).
  - UNIQUE (fecha_publicacion, expediente): permite re-importar un boletín sin duplicar.
  - Se carga con `npm run importar-boletin -- <archivo.csv>` (`scripts/importar-boletin.js`). Los CSV quedan versionados en `data/boletines/`. Formato: 11 columnas, Denominación y Solicitante URL-encoded, UTF-8 con BOM. Para producción, correr el script con `DATABASE_URL` de Neon. Al terminar, genera las alertas de ese boletín.

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

## Rutas existentes
- `POST /register` — valida campos + longitud de contraseña (mínimo 10) → hashea con bcrypt → inserta en `login` y `users` en una transacción.
- `POST /signin` — busca email en `login`, compara hash con bcrypt, devuelve el usuario de `users`.
- `GET /profile/:id` — devuelve un usuario por id.

### Marcas (`controllers/marcas.js`)
- `GET /marcas?user_id=X` — array de marcas del usuario, ordenadas por `fecha_solicitud` desc. 400 si `user_id` es inválido.
- `POST /marcas` con `{ user_id, ...marca }`:
  - 201 con la marca creada.
  - 400 `{ error, errores }` si no valida.
  - 409 si ya existe (mismo user_id + pais + expediente, código Postgres 23505).
  - 400 si el usuario no existe (23503).
- `POST /marcas/bulk` con `{ user_id, marcas: [...] }`:
  - Devuelve `{ insertadas: n, errores: [{ fila, error }] }`. `fila` es el índice (desde 0) en el array recibido; el frontend lo traduce a número de fila del archivo.
  - Máximo 1000 marcas por request.
  - Valida todo primero y hace un único INSERT con `ON CONFLICT DO NOTHING`. Las filas que no vuelven en `returning` se reportan como duplicadas.

### Boletines DINAPI (`controllers/boletines.js`)
- `GET /boletines/marcas` — todas las marcas del boletín, ordenadas por `fecha_publicacion` desc y `expediente`. Sin paginar todavía (se filtra en el frontend).

### Alertas (`controllers/alertas.js`)
- `GET /alertas?user_id=X` — filas planas: datos de la alerta, de mi marca (`mi_denominacion`, `mi_clase_niza`, `mi_expediente`) y de la marca del boletín (mismos nombres que en `/boletines/marcas`), más `vence_oposicion` y `dias_habiles_restantes` (negativo si venció). Orden: nuevas primero, después por score.
- `PATCH /alertas/:id` con `{ user_id, estado?, nota? }` — 200 `{ id, estado, nota }`; 400 si el estado es inválido o no hay cambios; 404 si la alerta no es de una marca del usuario.

## Validación de marcas
- `utils/marcaValidation.js` y `utils/paises.js` son COPIAS de `src/utils/marcaValidation.js` y `src/config/paises.js` del frontend (repo `nubio`). Única diferencia: el import usa `./paises.js`, porque Node ESM exige la extensión. Si cambia una regla, hay que cambiarla en los dos repos.
- `normalizarMarca` funciona también como whitelist de campos: el insert nunca recibe `req.body` directo, para evitar mass assignment.

## Convenciones importantes
- Las rutas de marcas responden errores como `{ error: 'mensaje' }`. Las rutas de auth (`/signin`, `/register`, `/profile`) todavía devuelven strings sueltos; está pendiente unificarlas.
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
- Reemplazar el login basado en localStorage del frontend por JWT con expiración, validado server-side.
- `user_id` viaja desde el cliente en las rutas de marcas, así que cualquiera puede leer o crear marcas de otro usuario. Se resuelve cuando entre JWT: sacar `user_id` del token verificado.
- Unificar el formato de errores de `/signin`, `/register` y `/profile` a `{ error }`.
- Mantener sincronizadas las copias de validación (`utils/`) con el frontend.
- Correr `sql/003_alertas.sql` en Neon antes de deployar el backend con alertas.
- Validar con el abogado (el motor todavía no se probó con un especialista):
  - lista de clases relacionadas (`clasesRelacionadas.js`) y si la clase 35 se relaciona con todos los productos;
  - términos genéricos y descriptivos por rubro (`terminosGenericos.js`), ej: CAFE en clase 30;
  - umbrales (70 / 85) y ajustes por clase;
  - si las renovaciones deben quedar excluidas;
  - cómputo del plazo: fecha del boletín vs. última publicación en el diario;
  - criterios de las Directrices de Examen de Marcas DINAPI (Res. 259/2025), sección derechos de terceros.
- Cargar los feriados trasladables del año en `utils/feriados.js`.

## Cómo ayudar en este proyecto
El dueño de este proyecto está aprendiendo Express, Postgres, Git y deployment en profundidad mientras lo construye. Preferencia explícita: explicar el porqué de cada cambio, no solo tirar código.