-- Datos del registro de cada marca (noviembre 2026). Todos opcionales: una
-- marca en trámite todavía no tiene registro, y las marcas ya cargadas no los
-- tienen.
--
-- - estado: como lo escribe DINAPI ("Concedida", "En Examen de Fondo"...).
--   Texto libre: son decenas y cambian; una lista cerrada se desactualizaría.
-- - numero_registro: solo dígitos, como el expediente (TEXT, para conservar
--   ceros a la izquierda).
-- - fecha_registro y fecha_vencimiento: base de los futuros avisos de
--   renovación. El vencimiento tiene que ser posterior al registro.
--
-- Los topes (100 y 20) son los mismos de utils/marcaValidation.js
-- (LARGO_MAXIMO_ESTADO, LARGO_MAXIMO_REGISTRO): si cambian, en los tres lados.
--
-- Correr en local y en el SQL Editor de Neon ANTES de deployar el backend:
-- sin las columnas, GET /marcas y el alta fallan (las consultas las piden).

ALTER TABLE marcas
  ADD COLUMN estado            text,
  ADD COLUMN numero_registro   text,
  ADD COLUMN fecha_registro    date,
  ADD COLUMN fecha_vencimiento date,
  ADD CONSTRAINT marcas_estado_largo CHECK (char_length(estado) <= 100),
  ADD CONSTRAINT marcas_numero_registro_valido CHECK (numero_registro ~ '^[0-9]{1,20}$'),
  ADD CONSTRAINT marcas_vencimiento_posterior CHECK (fecha_vencimiento > fecha_registro);
