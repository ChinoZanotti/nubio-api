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

## Cómo ayudar en este proyecto
El dueño de este proyecto está aprendiendo Express, Postgres, Git y deployment en profundidad mientras lo construye. Preferencia explícita: explicar el porqué de cada cambio, no solo tirar código.