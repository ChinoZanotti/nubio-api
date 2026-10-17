CREATE TABLE marcas (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fecha_solicitud DATE     NOT NULL,
  expediente      TEXT     NOT NULL CHECK (expediente ~ '^[0-9]+$'),
  clase_niza      SMALLINT NOT NULL CHECK (clase_niza BETWEEN 1 AND 45),
  denominacion    TEXT,
  signo           CHAR(1)  NOT NULL CHECK (signo IN ('M', 'D', 'F')),
  titular         TEXT     NOT NULL,
  pais            CHAR(2)  NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- solo las figurativas pueden no tener denominación
  CHECK (signo = 'F' OR COALESCE(denominacion, '') <> ''),
  -- un usuario no puede cargar dos veces el mismo expediente del mismo país
  UNIQUE (user_id, pais, expediente)
);
