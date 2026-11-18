-- Agrega los signos Tridimensional (T) y Sonora (S), que DINAPI publica en
-- los boletines (confirmado en el buscador de DINAPI: expedientes 2662329 y
-- 2690003). Antes solo existían M, D y F.
--
-- También amplía la regla de la denominación: además de las figurativas,
-- las tridimensionales y las sonoras pueden no tener texto.
--
-- Las restricciones originales se crearon sin nombre (001 y 002), así que
-- Postgres les puso uno automático. Las reemplazamos por otras con nombre
-- propio, para que la próxima vez se puedan cambiar sin adivinar.
-- Correr en local y en el SQL Editor de Neon.

BEGIN;

ALTER TABLE marcas DROP CONSTRAINT IF EXISTS marcas_signo_check;
ALTER TABLE marcas DROP CONSTRAINT IF EXISTS marcas_check;
ALTER TABLE marcas
  ADD CONSTRAINT marcas_signo_valido
    CHECK (signo IN ('M', 'D', 'F', 'T', 'S')),
  ADD CONSTRAINT marcas_denominacion_obligatoria
    CHECK (signo IN ('F', 'T', 'S') OR COALESCE(denominacion, '') <> '');

ALTER TABLE boletin_marcas DROP CONSTRAINT IF EXISTS boletin_marcas_signo_check;
ALTER TABLE boletin_marcas DROP CONSTRAINT IF EXISTS boletin_marcas_check;
ALTER TABLE boletin_marcas
  ADD CONSTRAINT boletin_marcas_signo_valido
    CHECK (signo IN ('M', 'D', 'F', 'T', 'S')),
  ADD CONSTRAINT boletin_marcas_denominacion_obligatoria
    CHECK (signo IN ('F', 'T', 'S') OR COALESCE(denominacion, '') <> '');

COMMIT;
