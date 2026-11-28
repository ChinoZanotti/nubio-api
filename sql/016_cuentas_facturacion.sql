-- Datos administrativos de las cuentas, notas y activación de clientes
-- (panel comercial, etapa 3, noviembre 2026).
--
-- cuentas_facturacion: lo que carga el equipo comercial al vender. Una fila por
-- cuenta, APARTE de cuentas y de users (revisión de Case de la idea, A6): son
-- datos personales y de cobro, y así ninguna ruta de clientes los lee por
-- accidente (un select('*') de más). Solo las rutas /admin.
-- - Sin datos de tarjetas ni de cuentas bancarias, nunca (PCI DSS): medio_pago
--   es una lista cerrada, y la pantalla lo avisa junto a las notas.
-- - modalidad 'automatica_mensual' es solo una etiqueta hasta que haya una
--   pasarela de pago: no cobra nada sola.
-- - dia_pago: el día del mes en que vence la cuota (precargado con el de la
--   fecha de ingreso). En los meses más cortos, el último día.
-- - monto_mensual en guaraníes, sin decimales. Cada pago (etapa 4) guarda lo
--   que se cobró de verdad, que puede diferir (descuentos, promociones).
-- - version: como en marcas. Dos operadores editando a la vez no se pisan (409).
--
-- notas_cuenta: notas con fecha y autor, una por fila (Molly: un solo cuadro
-- de texto con 2 o 3 personas escribiendo se pisa). No se editan ni se borran.
--
-- activaciones_usuario: el link con el que el CLIENTE crea su contraseña (el
-- comercial nunca la conoce: Case, A5). Mismo diseño que el de los operadores:
-- token de 32 bytes, en la base un HMAC con clave derivada de ADMIN_CIFRADO_KEY,
-- un solo uso, 72 h, en el fragmento de la URL. Sirve también para "olvidé mi
-- contraseña" mientras no haya correos: el comercial genera uno nuevo.
-- El usuario se crea SIN fila en login: no puede entrar hasta activar.
-- - revocada_at: el link se reemplazó por uno nuevo sin usarse (distinto de
--   usada_at, para que en una investigación se vea cuál fue cuál: Case, I2).
-- - Un solo link vigente por usuario (índice único parcial): si dos operadores
--   generan uno a la vez, el segundo falla en vez de dejar dos (Case, B2).
--
-- Compatible con el backend anterior: solo crea tablas nuevas.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE cuentas_facturacion (
  cuenta_id        INTEGER     PRIMARY KEY REFERENCES cuentas(id),
  nombre_completo  TEXT        NOT NULL CHECK (char_length(btrim(nombre_completo)) BETWEEN 1 AND 100),
  telefono         TEXT        NOT NULL CHECK (telefono ~ '^\+[0-9]{8,15}$'),
  ruc              TEXT        CHECK (ruc ~ '^[0-9]{1,9}-[0-9]$'),
  razon_social     TEXT        CHECK (char_length(btrim(razon_social)) BETWEEN 1 AND 200),
  medio_pago       TEXT        NOT NULL CHECK (medio_pago IN ('transferencia', 'efectivo', 'tarjeta', 'debito_automatico', 'otro')),
  modalidad        TEXT        NOT NULL CHECK (modalidad IN ('mensual', 'anual', 'automatica_mensual')),
  fecha_ingreso    DATE        NOT NULL,
  dia_pago         SMALLINT    NOT NULL CHECK (dia_pago BETWEEN 1 AND 31),
  monto_mensual    BIGINT      NOT NULL CHECK (monto_mensual > 0 AND monto_mensual <= 100000000),
  version          INTEGER     NOT NULL DEFAULT 1,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       INTEGER     REFERENCES operadores(id)
);

CREATE TABLE notas_cuenta (
  id           SERIAL      PRIMARY KEY,
  cuenta_id    INTEGER     NOT NULL REFERENCES cuentas(id),
  operador_id  INTEGER     NOT NULL REFERENCES operadores(id),
  texto        TEXT        NOT NULL CHECK (char_length(btrim(texto)) BETWEEN 1 AND 2000),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notas_cuenta_cuenta_idx ON notas_cuenta (cuenta_id, created_at DESC);

CREATE TABLE activaciones_usuario (
  id           SERIAL      PRIMARY KEY,
  user_id      INTEGER     NOT NULL REFERENCES users(id),
  token_hash   TEXT        NOT NULL UNIQUE,
  vence_at     TIMESTAMPTZ NOT NULL,
  usada_at     TIMESTAMPTZ,
  revocada_at  TIMESTAMPTZ,
  creada_por   INTEGER     REFERENCES operadores(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX activaciones_usuario_user_idx ON activaciones_usuario (user_id);
CREATE UNIQUE INDEX activaciones_usuario_vigente_idx ON activaciones_usuario (user_id)
  WHERE usada_at IS NULL AND revocada_at IS NULL;

COMMIT;
