# Borrar una cuenta

Pasos para borrar en producción una cuenta y todo lo suyo: una cancelación o una cuenta de prueba. El panel comercial no borra cuentas (decisión de noviembre 2026); lo hace el desarrollador con `npm run borrar-cuenta`.
Todos los comandos son para **PowerShell** y se corren desde `c:\dev\nubio-api-produccion`.

> ⚠️ **No se puede deshacer.** Se borran el usuario, su login, sus marcas con sus alertas (estados y notas incluidos), los datos administrativos, las notas del panel, los pagos y los links de acceso. Lo único que vuelve atrás es restaurar el backup (`docs/backups.md`).

**Qué queda:** la auditoría del panel (`auditoria_admin`), a propósito, para poder contestar después quién dio de alta la cuenta, quién la suspendió o quién registró sus pagos. Se le borran las IPs del cliente y se agrega `cuenta_borrada`, con las cantidades y sin datos personales. Las IPs de los operadores quedan.

**Fuera de la base**, los datos siguen un tiempo en:
- **los backups** (`.dump`, hasta 30, sin cifrar) hasta que roten;
- **los registros de Render**, con los eventos de seguridad, hasta que Render los rote.

Si la cancelación vino con un pedido de borrar los datos, queda completa recién cuando roten los dos.

> **Cancelación de un cliente real:** antes de borrar, confirmá con Cilia si los pagos y los datos de facturación (RUC, razón social) tienen que conservarse por motivos tributarios. El script los borra junto con todo lo demás; para conservarlos habría que adaptarlo.

---

## 1. Suspender la cuenta

El script solo borra cuentas **suspendidas hace más de 2 minutos**. Así hay que hacerlo en dos pasos deliberados, sus sesiones ya están cortadas y el motor ya no le genera alertas mientras se borra.

Suspendela desde el panel (su ficha → "Estado de la cuenta" → "Suspender cuenta") y esperá 2 minutos.

## 2. Hacer el backup

El script se niega a borrar si no hay un backup **de esta base** de hace menos de 2 horas:

```powershell
cd c:\dev\nubio-api-produccion
npm run backup
```

## 3. Poner el código al día y apuntar a producción

```powershell
git pull
$env:DATABASE_URL = "postgresql://..."   # la de Neon producción, solo para esta terminal
```

El script exige el `main` publicado. Si dice que falta, revisá que estés en esta carpeta y que `git pull` haya terminado bien.

## 4. Buscar el número de la cuenta

El panel no lo muestra. Buscala por nombre o por correo:

```powershell
npm run borrar-cuenta -- --buscar=barreto
```

Muestra número, nombre, estado y el correo enmascarado (`c***@dominio.com`). Si hay varias parecidas, fijate en el estado: la que vas a borrar tiene que decir `suspendida`.

## 5. Revisar lo que se borra y confirmar

```powershell
npm run borrar-cuenta -- --cuenta=12
```

Primero muestra la base (`Base: ...neon.tech`) y todo lo que tiene la cuenta: usuarios, marcas, alertas, pagos, notas y links.

**Si algo impide borrarla, lo dice y no pregunta nada:**
- **no está suspendida, o se suspendió hace menos de 2 minutos;**
- **falta el backup, o el código no es el publicado;**
- **tocaría datos de otra cuenta:** un usuario de esta cuenta cargó marcas que hoy son de otra (porque se lo movió de cuenta), o su correo está también en otra. Eso hay que revisarlo a mano antes de seguir.

**Si se puede, pide la confirmación:** escribí el **número y el nombre** de la cuenta, tal como aparecen (por ejemplo `12 Cesar Barreto`) y Enter. Cualquier otra cosa cancela sin borrar nada. La confirmación se escribe en la terminal y no en el comando: así no queda en el historial de PowerShell, y no se puede pegar un comando sin mirar lo que se borra.

Al terminar dice `Borrada: …` con las cantidades. Si entre lo que mostró y el borrado cambió algo (alguien la reactivó, se le registró un pago), no borra nada y lo dice: volvé a correr el paso 5.

Si dice que **la base tiene datos que dependen de la cuenta que el script no conoce**, es que una función nueva agregó una tabla o una columna que apunta a cuentas, usuarios o marcas, y nadie la sumó al borrado. No borra nada. Hay que sumarla en `services/borrarCuenta.js`: no la saltees a mano.

## 6. Cerrar

```powershell
Remove-Item Env:DATABASE_URL
```

En el panel, la cuenta ya no aparece en la lista: recargá la página si la tenías abierta.

---

## Varias cuentas

Repetí los pasos 4 y 5 por cada una. El backup del paso 2 sirve para todas mientras tenga menos de 2 horas.

## Probar en local

Sin `DATABASE_URL` en la terminal se usa el del `.env` (la base local). Contra la base local no se exigen el backup ni el `main` publicado, pero sí la suspensión y la confirmación. Para suspender en local: `npm run suspender-cuenta -- --cuenta=N --aplicar`.
