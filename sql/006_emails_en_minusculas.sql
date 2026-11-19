-- Emails siempre en minúsculas y sin espacios en los extremos.
-- El backend ya los normaliza al registrar y al iniciar sesión
-- (utils/authValidation.js). Esto pasa a minúsculas los que hubiera de antes
-- y agrega un CHECK para que la base no acepte otros en el futuro.
--
-- ANTES de correrlo en Neon, revisar que no haya dos cuentas que choquen
-- (ej: Juan@x.com y juan@x.com). Esta consulta tiene que devolver 0 filas:
--   SELECT lower(trim(email)), count(*) FROM login GROUP BY 1 HAVING count(*) > 1;
-- Si devuelve alguna, el UPDATE falla por el UNIQUE y no cambia nada: hay que
-- decidir a mano qué cuenta queda.
--
-- Correr ANTES de deployar el backend nuevo: si no, quien tenga el email
-- guardado con mayúsculas no va a poder iniciar sesión.
-- Correr en local y en el SQL Editor de Neon.

BEGIN;

UPDATE login SET email = lower(trim(email)) WHERE email <> lower(trim(email));
UPDATE users SET email = lower(trim(email)) WHERE email <> lower(trim(email));

ALTER TABLE login
  ADD CONSTRAINT login_email_minusculas CHECK (email = lower(trim(email)));
ALTER TABLE users
  ADD CONSTRAINT users_email_minusculas CHECK (email = lower(trim(email)));

COMMIT;
