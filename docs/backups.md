# Backups de la base de producción

`npm run backup` (`scripts/backup.js`) hace un `pg_dump` de Neon y lo guarda comprimido en una carpeta local. Comprueba que el archivo se pueda leer (`pg_restore --list`) y conserva los últimos 30.

**Por qué:** el plan gratis de Neon solo permite volver atrás unas horas. Si se borra algo y nadie lo nota en el día, no se puede recuperar.

## 1. Usuario de solo lectura en Neon (una sola vez)

El backup NO usa la misma URL que la API: esa es la del dueño de la base, que puede borrar tablas. Con un usuario de solo lectura, si alguien lee `backup.env` en esta computadora puede copiar los datos, pero no romper producción (revisión de Case del backup, M2).

1. Generar una contraseña (Neon pide contraseñas largas para los usuarios creados por SQL):
   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```
2. En el SQL Editor de Neon, conectado con el usuario dueño (el de la API, el que crea las tablas), reemplazando `<contraseña>` y `<base>` (el nombre de la base: lo que va después de la última `/` en la URL, sin el `?...`):
   ```sql
   CREATE ROLE nubio_backup LOGIN PASSWORD '<contraseña>';
   GRANT CONNECT ON DATABASE <base> TO nubio_backup;
   GRANT USAGE ON SCHEMA public TO nubio_backup;
   GRANT SELECT ON ALL TABLES IN SCHEMA public TO nubio_backup;
   GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO nubio_backup;
   -- Para las tablas que se creen más adelante con los sql/00X_*.sql:
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO nubio_backup;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON SEQUENCES TO nubio_backup;
   ```
   El `ALTER DEFAULT PRIVILEGES` vale solo para las tablas que cree ESE mismo usuario: los `sql/` se tienen que seguir corriendo con él.
3. Armar la URL del backup: la misma de la API, cambiando usuario y contraseña: `postgresql://nubio_backup:<contraseña>@<host>/<base>?sslmode=require`.
4. Comprobar que no puede escribir (pide la contraseña; `<host>` es el de la URL, sin `-pooler`):
   ```powershell
   $env:PGSSLMODE = "require"
   psql -h <host> -U nubio_backup -d <base> -c "DELETE FROM alertas WHERE false"
   Remove-Item Env:PGSSLMODE
   ```
   Tiene que dar `permission denied for table alertas`.

## 2. Configuración (una sola vez)

La URL lleva la contraseña: va en un archivo **fuera del repo**, nunca en el `.env` del proyecto.

En PowerShell:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.nubio"
notepad "$env:USERPROFILE\.nubio\backup.env"
```

Contenido:

```
BACKUP_DATABASE_URL=postgresql://nubio_backup:...   # la del paso 1, NO la de Render
BACKUP_DIR=C:\Users\cezan\Backups\nubio
```

- La URL puede ser la del pooler (`-pooler` en el host): el script la cambia sola a la conexión directa, que es la que Neon recomienda para `pg_dump`.
- La conexión va cifrada y con el certificado verificado (`verify-full`), igual que la API. Sin TLS solo acepta una base en esta misma máquina (`localhost`), para probar.
- `BACKUP_DIR` tiene que estar dentro de tu carpeta de usuario (`C:\Users\...`): ahí solo tu cuenta de Windows puede leer. El script se niega a guardar en otro lado.
- Si algo de la configuración está mal (`BACKUP_CONSERVAR` que no es un entero, URL mal escrita), corta sin conectarse ni borrar nada, y el mensaje no muestra la contraseña.
- Opcionales: `BACKUP_CONSERVAR=30` (cuántos guardar, entero de 1 en adelante) y `PG_BIN=C:\Program Files\PostgreSQL\18\bin` (si `pg_dump` no está en el PATH).

Probarlo a mano:

```powershell
cd C:\dev\nubio-api-produccion
npm run backup
```

Tiene que terminar con `Listo: ...nubio-aaaa-mm-dd_hhmmss.dump (x MB, n tablas con datos)`: hoy son 6 (`cuentas`, `users`, `login`, `marcas`, `alertas`, `boletin_marcas`).

## 3. Programarlo (Programador de tareas de Windows)

PowerShell, una sola vez:

```powershell
$accion = New-ScheduledTaskAction -Execute "cmd.exe" -Argument '/c "cd /d C:\dev\nubio-api-produccion && npm run backup >> %USERPROFILE%\.nubio\backup.log 2>&1"'
$cuando = New-ScheduledTaskTrigger -Daily -At 13:00
$opciones = New-ScheduledTaskSettingsSet -StartWhenAvailable
Register-ScheduledTask -TaskName "Nubio backup" -Action $accion -Trigger $cuando -Settings $opciones
```

- Corre todos los días a las 13:00. `-StartWhenAvailable` hace que, si a esa hora la computadora estaba apagada, corra apenas se prenda.
- Correrlo ya, para probar: `Start-ScheduledTask -TaskName "Nubio backup"`, y después mirar `$env:USERPROFILE\.nubio\backup.log`.
- Borrar la tarea: `Unregister-ScheduledTask -TaskName "Nubio backup"`.
- Corre el script que haya en `C:\dev\nubio-api-produccion` en ese momento: la copia del repo que está siempre en `main` (ver `importar-boletines.md`). No desde `C:\dev\nubio-api`, que puede estar en otra rama con cambios a medias.

## 4. Restaurar

**Nunca restaurar encima de producción a ciegas.** Primero en una base local, para mirar qué hay. Sin escribir la contraseña en el comando: así no queda en el historial de PowerShell; `psql` y `pg_restore` la piden.

```powershell
psql -h localhost -U postgres -c "CREATE DATABASE nubio_restore"
pg_restore --no-owner -h localhost -U postgres -d nubio_restore "C:\Users\cezan\Backups\nubio\nubio-aaaa-mm-dd_hhmmss.dump"
```

Al terminar, borrarla: es otra copia de los datos de los clientes.

```powershell
psql -h localhost -U postgres -c "DROP DATABASE nubio_restore"
```

- Una sola tabla: agregar `--table=alertas` (por ejemplo).
- Volcar producción entera desde un backup es el último recurso, y se hace en Neon con una rama nueva: restaurar ahí, comprobar, y recién después apuntar `DATABASE_URL` a la rama.

Probado en noviembre de 2026: backup de la base local y restauración en una base aparte, con las mismas filas en `users`, `marcas`, `boletin_marcas` (14.008) y `alertas`. Contra Neon, el backup funciona con `verify-full`.

## Cuidados

- Los `.dump` tienen datos de clientes del estudio y los hashes de las contraseñas, **sin cifrar**. No subirlos a git, no compartirlos y no ponerlos en una carpeta sincronizada con la nube (OneDrive, Drive): quien entre a esa cuenta tendría toda la base.
- Si la computadora se rompe o se pierde, se pierden los backups locales. Para tener una copia afuera hay que cifrarlos antes (por ejemplo con `age`, con la clave guardada fuera de la PC). Pendiente (revisión de Case del backup, M4).
- Si un backup se corta a la mitad, queda un `.dump.parcial`. El script lo borra en una corrida posterior (los de más de un día).
