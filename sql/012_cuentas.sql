-- Entidad "cuenta" (noviembre 2026): el agente o el estudio que contrata Nubio.
--
-- Por qué ahora: el plan para agencias va a tener varios usuarios en una misma
-- cuenta, que comparten las marcas. Si las marcas siguieran colgando del
-- usuario, ese día habría que mudar datos de clientes reales con la app en
-- uso. Hoy cada cuenta tiene un solo usuario, así que la mudanza es trivial y
-- se hace ahora. Las tablas nuevas (clientes, historial, cobros) nacen
-- colgando de la cuenta.
--
-- Qué cambia:
-- - cuentas: nombre, plan contratado ('basico' o 'agencia') y alta.
-- - users.cuenta_id: a qué cuenta pertenece cada usuario. Se crea una cuenta
--   por cada usuario que ya existe, con su nombre (o su correo, si no tiene).
-- - marcas.cuenta_id: de qué cuenta es la marca. Es lo que define quién la ve.
--   marcas.user_id queda como "quién la cargó" (ver 013).
-- - La regla "no dos veces el mismo expediente del mismo país" pasa a ser por
--   cuenta.
--
-- Las claves foráneas a cuentas NO borran en cascada: borrar una cuenta tiene
-- que ser un paso deliberado (con sus marcas y usuarios), nunca el efecto
-- colateral de otro DELETE.
--
-- Orden: correr en local y en el SQL Editor de Neon ANTES de deployar el
-- backend. Mientras tanto sigue corriendo el backend anterior, que inserta
-- marcas sin cuenta_id: el trigger la completa desde el usuario, así que no
-- falla. El backend nuevo la manda siempre. Después de que el backend nuevo
-- esté live, correr 013_cuentas_cierre.sql.
--
-- El alta de usuarios del backend anterior fallaría (users.cuenta_id es
-- obligatorio), pero el registro está cerrado en producción: responde 403
-- antes de tocar la base.
--
-- Antes de correrlo en Neon: `npm run backup`, y que nadie esté importando
-- marcas ni boletines (revisión de Case).
--
-- lock_timeout (revisión de Case, M1): cada ALTER TABLE bloquea la tabla
-- entera. Si una transacción larga la está usando (una importación, una
-- regeneración de alertas), el ALTER espera, y detrás de él quedan esperando
-- todos los pedidos de la API. Con el tope, si en 5 s no consigue la tabla,
-- falla y se deshace TODO (va en una transacción): se vuelve a correr.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE cuentas (
  id          SERIAL PRIMARY KEY,
  nombre      TEXT        NOT NULL CHECK (char_length(btrim(nombre)) BETWEEN 1 AND 300),
  plan        TEXT        NOT NULL DEFAULT 'basico' CHECK (plan IN ('basico', 'agencia')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN cuenta_id INTEGER REFERENCES cuentas(id);

-- Una cuenta por cada usuario existente
DO $$
DECLARE
  u     RECORD;
  nueva INTEGER;
BEGIN
  FOR u IN SELECT id, name, email, joined FROM users WHERE cuenta_id IS NULL ORDER BY id LOOP
    INSERT INTO cuentas (nombre, created_at)
      VALUES (COALESCE(NULLIF(btrim(u.name), ''), u.email), COALESCE(u.joined, now()))
      RETURNING id INTO nueva;
    UPDATE users SET cuenta_id = nueva WHERE id = u.id;
  END LOOP;
END $$;

ALTER TABLE users ALTER COLUMN cuenta_id SET NOT NULL;
CREATE INDEX users_cuenta_id_idx ON users (cuenta_id);

-- Cambiar a un usuario de cuenta cierra todas sus sesiones (revisión de Case,
-- M4): sube token_version, como al cambiar la contraseña. Con el plan para
-- agencias, "alguien deja el estudio" tiene que cortar el acceso en el acto, y
-- la pantalla abierta no puede seguir mostrando los datos de la cuenta
-- anterior (el frontend monta la app por id de usuario, que no cambia). En la
-- base y no en el código: vale también para un UPDATE hecho a mano.
-- Va DESPUÉS de completar cuenta_id: si no, ese UPDATE cerraría todas las
-- sesiones abiertas.
CREATE FUNCTION users_cambio_cuenta() RETURNS trigger AS $$
BEGIN
  IF NEW.cuenta_id IS DISTINCT FROM OLD.cuenta_id THEN
    NEW.token_version := OLD.token_version + 1;
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_cambio_cuenta
  BEFORE UPDATE OF cuenta_id ON users
  FOR EACH ROW EXECUTE FUNCTION users_cambio_cuenta();

ALTER TABLE marcas ADD COLUMN cuenta_id INTEGER REFERENCES cuentas(id);
UPDATE marcas m SET cuenta_id = u.cuenta_id FROM users u WHERE u.id = m.user_id;

-- Transitorio: mientras el backend anterior siga corriendo, completa la cuenta
-- de las marcas que inserte. Lo borra 013_cuentas_cierre.sql.
CREATE FUNCTION marcas_cuenta_desde_usuario() RETURNS trigger AS $$
BEGIN
  IF NEW.cuenta_id IS NULL THEN
    SELECT cuenta_id INTO NEW.cuenta_id FROM users WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER marcas_cuenta_desde_usuario
  BEFORE INSERT ON marcas
  FOR EACH ROW EXECUTE FUNCTION marcas_cuenta_desde_usuario();

ALTER TABLE marcas ALTER COLUMN cuenta_id SET NOT NULL;

-- Sirve también de índice para "las marcas de esta cuenta" (empieza por cuenta_id).
-- La regla vieja (user_id, pais, expediente) sigue hasta 013: el backend
-- anterior la usa en su ON CONFLICT.
ALTER TABLE marcas
  ADD CONSTRAINT marcas_cuenta_pais_expediente_key UNIQUE (cuenta_id, pais, expediente);

COMMIT;
