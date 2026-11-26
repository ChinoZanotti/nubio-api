-- Versión de cada marca, para que dos ediciones simultáneas no se pisen
-- (revisión de Case de editar/borrar marcas, M2).
--
-- Hoy las 3 personas del estudio usan la misma cuenta. Si dos abren la misma
-- marca y guardan, la segunda borraba sin aviso lo que corrigió la primera.
-- Ahora el formulario manda la versión que leyó; PATCH /marcas/:id solo guarda
-- si sigue siendo la vigente, y la sube en 1. Si otra persona guardó antes,
-- responde 409 y pide recargar.
--
-- Un número y no updated_at: Postgres guarda microsegundos y JavaScript solo
-- milisegundos, así que una fecha que va al navegador y vuelve ya no coincide.
--
-- DEFAULT 1: las marcas que ya existen arrancan en 1, sin tocar nada más.
--
-- Correr en local y en el SQL Editor de Neon ANTES de deployar el backend:
-- sin la columna, GET /marcas y el alta fallan (las consultas la piden).

ALTER TABLE marcas
  ADD COLUMN version integer NOT NULL DEFAULT 1;
