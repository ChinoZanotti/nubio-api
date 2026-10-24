-- Marcas publicadas en los boletines de DINAPI. Son datos públicos, no de un
-- usuario: por eso no hay user_id. Los nombres de columna coinciden con los de
-- `marcas` cuando significan lo mismo.
CREATE TABLE boletin_marcas (
  id                SERIAL PRIMARY KEY,
  fecha_publicacion DATE     NOT NULL,
  expediente        TEXT     NOT NULL CHECK (expediente ~ '^[0-9]+$'),
  clase_niza        SMALLINT NOT NULL CHECK (clase_niza BETWEEN 1 AND 45),
  denominacion      TEXT,
  signo             CHAR(1)  NOT NULL CHECK (signo IN ('M', 'D', 'F')),
  titular           TEXT     NOT NULL, -- "Solicitante" en el boletín
  pais              CHAR(2)  NOT NULL,
  agente            TEXT,
  matricula         TEXT,
  tramite           TEXT     NOT NULL, -- 'Registro de Marcas' / 'Renovación de Marcas'
  referencia        TEXT,              -- registro anterior, solo en renovaciones
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- solo las figurativas pueden no tener denominación
  CHECK (signo = 'F' OR COALESCE(denominacion, '') <> ''),
  -- permite volver a importar el mismo boletín sin duplicar filas
  UNIQUE (fecha_publicacion, expediente)
);
