-- Cierre de la entidad "cuenta" (segunda parte de 012_cuentas.sql).
--
-- Correr en Neon con el backend nuevo YA live, y sin apuro: mejor un día o
-- dos después (revisión de Case, M2). Saca lo que solo hacía falta mientras
-- corría el backend anterior.
--
-- - El trigger que completaba marcas.cuenta_id: el backend nuevo la manda.
-- - La regla vieja (user_id, pais, expediente): la reemplaza la de la cuenta.
-- - marcas.user_id pasa a ser "quién la cargó": opcional, y si se borra el
--   usuario queda en NULL en vez de borrar la marca. Con el plan para
--   agencias, que alguien deje el estudio no puede llevarse la cartera.
-- - Índice en marcas.user_id (Case, B3): sin la regla vieja no queda ninguno
--   que empiece por user_id, y borrar un usuario recorrería todas las marcas
--   de todas las cuentas para ponerlo en NULL.
--
-- DESPUÉS DE ESTO NO SE PUEDE VOLVER AL BACKEND ANTERIOR (el de antes de las
-- cuentas) con el Rollback de Render: sus altas fallan (cuenta_id es
-- obligatorio y ya no hay trigger) y su importación también (su ON CONFLICT
-- usa la regla vieja). Si hiciera falta volver, primero correr el SQL de
-- "Deshacer" que está al final de este archivo.
--
-- Antes de correrlo, confirmar en Neon los nombres de las reglas que borra:
--   SELECT conname FROM pg_constraint WHERE conrelid = 'marcas'::regclass;
-- Tienen que aparecer marcas_user_id_pais_expediente_key y marcas_user_id_fkey.
-- Si no coinciden, el script falla entero sin cambiar nada.

BEGIN;
SET LOCAL lock_timeout = '5s';

DROP TRIGGER marcas_cuenta_desde_usuario ON marcas;
DROP FUNCTION marcas_cuenta_desde_usuario();

ALTER TABLE marcas DROP CONSTRAINT marcas_user_id_pais_expediente_key;

ALTER TABLE marcas ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE marcas DROP CONSTRAINT marcas_user_id_fkey;
ALTER TABLE marcas
  ADD CONSTRAINT marcas_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX marcas_user_id_idx ON marcas (user_id);

COMMIT;

-- Deshacer (solo para volver al backend anterior; no correr de rutina).
-- Devuelve lo que ese backend necesita: el trigger y la regla vieja.
--
-- BEGIN;
-- SET LOCAL lock_timeout = '5s';
-- CREATE FUNCTION marcas_cuenta_desde_usuario() RETURNS trigger AS $$
-- BEGIN
--   IF NEW.cuenta_id IS NULL THEN
--     SELECT cuenta_id INTO NEW.cuenta_id FROM users WHERE id = NEW.user_id;
--   END IF;
--   RETURN NEW;
-- END
-- $$ LANGUAGE plpgsql;
-- CREATE TRIGGER marcas_cuenta_desde_usuario
--   BEFORE INSERT ON marcas
--   FOR EACH ROW EXECUTE FUNCTION marcas_cuenta_desde_usuario();
-- ALTER TABLE marcas
--   ADD CONSTRAINT marcas_user_id_pais_expediente_key UNIQUE (user_id, pais, expediente);
-- COMMIT;
