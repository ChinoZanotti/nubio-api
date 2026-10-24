-- Posibles conflictos entre una marca de un usuario y una marca publicada en un
-- boletín de DINAPI. Las genera el motor de similitud (utils/similitud/).
-- No lleva user_id: el dueño sale de marcas.user_id con un JOIN, así el dato
-- no se duplica y no puede quedar inconsistente.
CREATE TABLE alertas (
  id               SERIAL PRIMARY KEY,
  marca_id         INTEGER  NOT NULL REFERENCES marcas(id) ON DELETE CASCADE,
  boletin_marca_id INTEGER  NOT NULL REFERENCES boletin_marcas(id) ON DELETE CASCADE,
  score            SMALLINT NOT NULL CHECK (score BETWEEN 0 AND 100),
  nivel            TEXT     NOT NULL CHECK (nivel IN ('alta', 'media')),
  motivos          TEXT[]   NOT NULL DEFAULT '{}',
  relacion_clase   TEXT     NOT NULL CHECK (relacion_clase IN ('misma', 'relacionada', 'otra')),
  estado           TEXT     NOT NULL DEFAULT 'nueva'
                   CHECK (estado IN ('nueva', 'en_revision', 'a_oponer', 'descartada')),
  nota             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- volver a generar alertas no duplica ni pisa el estado que puso el usuario
  UNIQUE (marca_id, boletin_marca_id)
);
