-- Pagos de las cuentas (panel comercial, etapa 4, noviembre 2026).
--
-- Las cuotas se pagan por adelantado, fuera del sistema (el equipo comercial
-- cobra y registra el pago a mano en el panel). Cada pago cubre un período:
-- un mes, o doce si la modalidad es anual. "Pagado hasta" (la fecha en que
-- vence la cuota siguiente) es el MÁXIMO `hasta` de los pagos no anulados: no
-- se guarda aparte, así nunca queda desfasado de los pagos.
--
-- - desde / hasta: el período que cubre. `hasta` es el día en que vence la
--   cuota siguiente (el último día cubierto es el anterior). Los calcula el
--   servidor (utils/cuotas.js); `desde` se puede cambiar en el formulario para
--   las excepciones.
-- - monto: lo que se cobró de verdad, en guaraníes. Puede diferir del monto
--   mensual de la cuenta (descuentos, promociones).
-- - medio_pago: la misma lista cerrada que cuentas_facturacion. Sin datos de
--   tarjetas ni de cuentas bancarias, nunca.
-- - Los pagos NO se borran: se anulan, con motivo, quién y cuándo. Solo el
--   último pago vigente se puede anular (los siguientes se calcularon a partir
--   de él); lo controla el servidor.
-- - Dos pagos vigentes de una cuenta no pueden cubrir el mismo día (Case, M1
--   de la etapa 4): lo garantiza la base con una restricción de exclusión sobre
--   el rango [desde, hasta). Necesita la extensión btree_gist (Neon la trae;
--   CREATE EXTENSION lo puede correr el dueño de la base).
-- - dia_pago_anterior y version_facturacion: si el pago cambió el día de pago
--   de la cuenta, el día que tenía antes y la versión de los datos que dejó.
--   Al anular el pago se restaura el día anterior, si nadie editó los datos
--   después (si no, se avisa).
--
-- Compatible con el backend anterior: solo crea una tabla nueva.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE pagos_cuenta (
  id                 SERIAL      PRIMARY KEY,
  cuenta_id          INTEGER     NOT NULL REFERENCES cuentas(id),
  fecha_pago         DATE        NOT NULL,
  desde              DATE        NOT NULL,
  hasta              DATE        NOT NULL,
  meses              SMALLINT    NOT NULL CHECK (meses IN (1, 12)),
  monto              BIGINT      NOT NULL CHECK (monto > 0 AND monto <= 1200000000),
  medio_pago         TEXT        NOT NULL CHECK (medio_pago IN ('transferencia', 'efectivo', 'tarjeta', 'debito_automatico', 'otro')),
  operador_id        INTEGER     NOT NULL REFERENCES operadores(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  anulado_at         TIMESTAMPTZ,
  anulado_por        INTEGER     REFERENCES operadores(id),
  motivo_anulacion   TEXT        CHECK (char_length(btrim(motivo_anulacion)) BETWEEN 1 AND 500),
  dia_pago_anterior  SMALLINT    CHECK (dia_pago_anterior BETWEEN 1 AND 31),
  version_facturacion INTEGER,
  CONSTRAINT pagos_cuenta_periodo CHECK (hasta > desde),
  CONSTRAINT pagos_cuenta_anulacion CHECK ((anulado_at IS NULL) = (motivo_anulacion IS NULL)),
  CONSTRAINT pagos_cuenta_sin_superponer EXCLUDE USING gist (cuenta_id WITH =, daterange(desde, hasta) WITH &&)
    WHERE (anulado_at IS NULL)
);
CREATE INDEX pagos_cuenta_vigentes_idx ON pagos_cuenta (cuenta_id, hasta DESC) WHERE anulado_at IS NULL;
CREATE INDEX pagos_cuenta_cuenta_idx ON pagos_cuenta (cuenta_id, created_at DESC);

COMMIT;
