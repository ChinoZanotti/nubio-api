-- El signo de una marca propia pasa a ser opcional (noviembre 2026).
--
-- Por qué: el estudio importa su cartera desde un listado de DINAPI que no
-- trae el tipo de signo, y no tiene ese dato a mano. Inventarlo (poner
-- "Denominativa" a todas) sería cargar un dato falso en un sistema que usa
-- una abogada. NULL = "sin dato".
--
-- Para el motor no cambia casi nada: el signo solo se usa para saber si una
-- marca es figurativa (y entonces no se compara texto). Una marca sin signo y
-- con denominación se compara como cualquier otra.
--
-- La regla de la denominación se ajusta: puede faltar solo si el signo es F,
-- T o S. SIN signo, la denominación es obligatoria (si no, quedaría una marca
-- sin texto ni tipo). COALESCE(signo, '') porque `NULL IN (...)` da NULL, y
-- un CHECK con NULL cuenta como aprobado: sin el COALESCE, una marca sin signo
-- ni denominación pasaría.
--
-- Solo `marcas`. En `boletin_marcas` el signo sigue siendo obligatorio: los
-- boletines de DINAPI siempre lo traen.
--
-- Se puede correr en Neon ANTES de deployar el backend: solo afloja reglas, y
-- el backend anterior sigue mandando siempre un signo.

BEGIN;

ALTER TABLE marcas ALTER COLUMN signo DROP NOT NULL;

ALTER TABLE marcas DROP CONSTRAINT marcas_denominacion_obligatoria;
ALTER TABLE marcas
  ADD CONSTRAINT marcas_denominacion_obligatoria
    CHECK (COALESCE(signo, '') IN ('F', 'T', 'S') OR COALESCE(denominacion, '') <> '');

COMMIT;
