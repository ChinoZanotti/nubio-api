-- Topes de largo para denominación y titular de las marcas de los usuarios.
-- Son los mismos que valida utils/marcaValidation.js (y su copia en el frontend):
-- la base es la última defensa si algún día un camino nuevo inserta sin validar.
--
-- Sin tope, un texto enorme hace que el motor de similitud (costo largo × largo,
-- contra miles de marcas del boletín) congele el servidor.
--
-- Solo en `marcas`: `boletin_marcas` la carga el importador con datos oficiales
-- de DINAPI (máximo visto: 181 y 145 caracteres), y un CHECK ahí podría trabar
-- la importación de un boletín por un error de carga de ellos.
--
-- Si alguna fila existente ya supera el tope, el ALTER falla y no cambia nada.
-- Correr en local y en el SQL Editor de Neon.

ALTER TABLE marcas
  ADD CONSTRAINT marcas_denominacion_largo_maximo
    CHECK (char_length(denominacion) <= 300),
  ADD CONSTRAINT marcas_titular_largo_maximo
    CHECK (char_length(titular) <= 500);
