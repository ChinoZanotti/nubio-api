-- Estado de la cuenta: activa o suspendida (panel comercial, etapa 1,
-- noviembre 2026).
--
-- Suspender lo decide siempre una persona del equipo comercial (en la
-- práctica, cuando vence la cuota). Una cuenta suspendida:
-- - no puede iniciar sesión (signin), y sus sesiones abiertas se cortan: el
--   trigger de abajo sube token_version de todos sus usuarios, igual que al
--   cambiar la contraseña o al mover a alguien de cuenta;
-- - no recibe alertas de los boletines nuevos (services/alertas.js). Al
--   reactivarla se generan las que se perdió, contra lo que sigue en plazo.
-- No se borra nada: reactivar la deja como estaba.
--
-- estado_desde: cuándo cambió el estado por última vez. Lo completa el
-- trigger. Sirve para mostrar "suspendida desde" y, en la etapa de pagos, para
-- que el tiempo suspendido no cuente como cuota.
--
-- Sin 'cancelada' a propósito: cancelar y borrar una cuenta no se hace desde
-- el panel (decisión de noviembre 2026), lo hace el desarrollador a mano.
--
-- Compatible con el backend anterior: solo agrega columnas con valor por
-- defecto, que ese backend ignora. Se puede correr antes del deploy.

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE cuentas
  ADD COLUMN estado TEXT NOT NULL DEFAULT 'activa'
    CONSTRAINT cuentas_estado_valido CHECK (estado IN ('activa', 'suspendida')),
  ADD COLUMN estado_desde TIMESTAMPTZ NOT NULL DEFAULT now();

-- En la base y no en el código: vale también para un UPDATE hecho a mano.
-- Solo al SUSPENDER se cierran las sesiones; al reactivar no hay ninguna
-- abierta que cerrar (el login estaba bloqueado).
CREATE FUNCTION cuentas_cambio_estado() RETURNS trigger AS $$
BEGIN
  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    NEW.estado_desde := now();
    IF NEW.estado = 'suspendida' THEN
      UPDATE users SET token_version = token_version + 1 WHERE cuenta_id = NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER cuentas_cambio_estado
  BEFORE UPDATE OF estado ON cuentas
  FOR EACH ROW EXECUTE FUNCTION cuentas_cambio_estado();

COMMIT;
