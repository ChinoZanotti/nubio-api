-- Operadores del panel comercial y auditoría (panel comercial, etapa 2,
-- noviembre 2026). Diseño con las revisiones de Case de la idea del panel y
-- de esta etapa.
--
-- operadores: las personas del equipo comercial que usan el panel. Es una
-- tabla APARTE de users a propósito (Case, A3): ningún error en las rutas de
-- clientes (un PATCH /me, un campo de más) puede volver operador a un cliente,
-- y las sesiones se firman con otra clave (utils/tokenOperador.js).
-- - Nominales: una fila por persona, nunca una compartida (si no, la
--   auditoría no dice quién hizo qué).
-- - Los crea el desarrollador con un script (npm run operadores -- crear), que
--   da un link de activación de un solo uso. La persona elige su contraseña y
--   configura el código de 2 pasos (TOTP) en esa pantalla: nadie más conoce
--   su contraseña ni su secreto.
-- - hash y totp_secreto quedan en NULL hasta que active. totp_secreto va
--   CIFRADO (AES-256-GCM, utils/cifrado.js, clave ADMIN_CIFRADO_KEY) y atado a
--   su operador: con un backup robado no alcanza, y no se puede copiar el de
--   otro operador a esta fila.
-- - token_version: como en users. Desactivar, resetear o cerrar sesión lo sube
--   y corta sus sesiones.
-- - ultimo_paso_totp: el último código aceptado (en pasos de 30 s). Un código
--   no se puede usar dos veces (alguien que lo vio por encima del hombro).
-- - desafio_id: el desafío vigente del login (el paso entre la contraseña y el
--   código). Es de un solo uso: el código correcto lo gasta, y un login nuevo
--   lo reemplaza (revisión de Case de la etapa 2, A1).
-- - Códigos incorrectos, en la BASE y no en memoria (Case, A1: en memoria se
--   esquivaba con pedidos en paralelo y se borraba con cada deploy):
--   - fallos_ventana / ventana_desde: a los 5 en 15 minutos, hay que esperar;
--   - fallos_seguidos: a los 20 sin un acierto, bloqueado_at y solo el
--     desarrollador lo destraba (npm run operadores -- resetear).
--   Cada intento se reserva ANTES de comprobar el código, en una sola sentencia.
-- - No se borran: se desactivan (activo = false), para que la auditoría siga
--   diciendo quién fue.
--
-- activaciones_operador: los links de activación. Se guarda un HMAC del token
-- con una clave derivada de ADMIN_CIFRADO_KEY, nunca el token: con la base no
-- alcanza para activar, y quien pueda escribir en la base no puede fabricar un
-- link (Case, B6). Un solo uso, vencen a las 72 h. El secreto TOTP se genera
-- al crear el link (cifrado) para que la pantalla muestre siempre el mismo QR,
-- y se borra de acá al activar (Case, M2).
--
-- auditoria_admin: quién hizo qué en el panel (y en los scripts de cuentas y
-- de operadores). En la base y no solo en los logs de Render (Case, M3): los
-- logs duran poco y "¿quién suspendió este estudio hace 4 meses?" tiene que
-- poder contestarse. detalle sin datos personales: ids y nombres de campos,
-- no valores. cuenta_id sin clave foránea a propósito: si algún día se borra
-- una cuenta (a mano, por el desarrollador), su rastro queda.
--
-- Compatible con el backend anterior: solo crea tablas nuevas.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE operadores (
  id               SERIAL PRIMARY KEY,
  nombre           TEXT        NOT NULL CHECK (char_length(btrim(nombre)) BETWEEN 1 AND 100),
  email            TEXT        NOT NULL UNIQUE
                   CHECK (email = lower(btrim(email)) AND char_length(email) BETWEEN 3 AND 254),
  hash             TEXT,
  totp_secreto     TEXT,
  token_version    INTEGER     NOT NULL DEFAULT 0,
  ultimo_paso_totp BIGINT,
  desafio_id       TEXT,
  fallos_ventana   INTEGER     NOT NULL DEFAULT 0,
  ventana_desde    TIMESTAMPTZ,
  fallos_seguidos  INTEGER     NOT NULL DEFAULT 0,
  bloqueado_at     TIMESTAMPTZ,
  activo           BOOLEAN     NOT NULL DEFAULT true,
  activado_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Activado = tiene contraseña Y segundo factor, los dos o ninguno
  CHECK ((hash IS NULL) = (totp_secreto IS NULL))
);

CREATE TABLE activaciones_operador (
  id            SERIAL PRIMARY KEY,
  operador_id   INTEGER     NOT NULL REFERENCES operadores(id),
  token_hash    TEXT        NOT NULL UNIQUE,
  -- NULL después de usarla: el secreto queda solo en operadores
  totp_secreto  TEXT,
  vence_at      TIMESTAMPTZ NOT NULL,
  usada_at      TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX activaciones_operador_operador_idx ON activaciones_operador (operador_id);

CREATE TABLE auditoria_admin (
  id           BIGSERIAL   PRIMARY KEY,
  operador_id  INTEGER     REFERENCES operadores(id),
  origen       TEXT        NOT NULL CHECK (origen IN ('panel', 'script')),
  accion       TEXT        NOT NULL,
  cuenta_id    INTEGER,
  detalle      JSONB       NOT NULL DEFAULT '{}',
  ip           TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX auditoria_admin_cuenta_idx ON auditoria_admin (cuenta_id, created_at DESC);
CREATE INDEX auditoria_admin_operador_idx ON auditoria_admin (operador_id, created_at DESC);

COMMIT;
