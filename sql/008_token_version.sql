-- Versión de las sesiones de cada usuario (I3 de la segunda revisión de Case).
--
-- Cada token lleva la versión vigente cuando se emitió (claim `tv`).
-- requireAuth rechaza los tokens con una versión distinta de la de esta
-- columna. Cambiar la contraseña la incrementa: todas las sesiones abiertas
-- dejan de valer, menos la que hizo el cambio, que recibe un token nuevo.
--
-- DEFAULT 0 y los tokens emitidos antes de esta columna (sin `tv`) se leen
-- como 0: nadie pierde la sesión al deployar.
--
-- Correr en local y en el SQL Editor de Neon ANTES de deployar el backend:
-- sin la columna, el login y todas las rutas protegidas fallan.

ALTER TABLE users
  ADD COLUMN token_version integer NOT NULL DEFAULT 0;
