-- Tope de largo para el expediente de las marcas de los usuarios.
-- Es el mismo que valida utils/marcaValidation.js (y su copia en el frontend).
--
-- Los expedientes reales tienen 7 a 10 dígitos. Sin tope, uno de 100.000
-- dígitos supera el tamaño máximo de una fila del índice UNIQUE
-- (user_id, pais, expediente) y Postgres falla con un error 54000: en una
-- importación, esa sola fila hace fallar todas.
--
-- Solo en `marcas`, igual que sql/005: `boletin_marcas` la carga el importador
-- con datos oficiales de DINAPI.
--
-- Si alguna fila existente ya supera el tope, el ALTER falla y no cambia nada.
-- Correr en local y en el SQL Editor de Neon.

ALTER TABLE marcas
  ADD CONSTRAINT marcas_expediente_largo_maximo
    CHECK (char_length(expediente) <= 20);
