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
- Tablas actuales: `login` (id, hash, email) y `users` (id, name, email, joined, marcas). Falta agregar `avatar_url` a `users`.
- Sintaxis SQL específica de Postgres (ej: `TRUNCATE TABLE nombre RESTART IDENTITY;`).

## Rutas existentes
- `POST /register` — valida campos + longitud de contraseña (mínimo 10) → hashea con bcrypt → inserta en `login` y `users` en una transacción.
- `POST /signin` — busca email en `login`, compara hash con bcrypt, devuelve el usuario de `users`.
- `GET /profile/:id` — devuelve un usuario por id.
- `PUT /marcas` — incrementa el contador `marcas` de un usuario.

## Convenciones importantes
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

## Cómo ayudar en este proyecto
El dueño de este proyecto está aprendiendo Express, Postgres, Git y deployment en profundidad mientras lo construye. Preferencia explícita: explicar el porqué de cada cambio, no solo tirar código.