# Importar boletines diarios de DINAPI

Pasos para cargar en producción los boletines **diarios** (`boletin_marcas_principales_aaaa-mm-dd.csv`).
Todos los comandos son para **PowerShell** y se corren desde `c:\dev\nubio-api`.

> ⚠️ No abras los CSV con Excel ni los guardes desde ahí: convierte números en fechas ("595" → "17/08/1901") y borra ceros a la izquierda. Para mirarlos, VS Code.

---

## 1. Ver cuál fue el último boletín cargado

```powershell
cd c:\dev\nubio-api
Get-ChildItem data\boletines\*.csv | Select-Object -Last 3 -ExpandProperty Name
```

Bajá de DINAPI los días hábiles posteriores a ese.

## 2. Copiar los descargados con el nombre correcto

Copia cada `boletin_marcas_principales_aaaa-mm-dd.csv` de Descargas a `data\boletines\aaaa-mm-dd.csv`. Si alguno ya existe, no lo pisa.

```powershell
Get-ChildItem "$HOME\Downloads\boletin_marcas_principales_*.csv" | ForEach-Object {
  $destino = "data\boletines\" + ($_.Name -replace '^boletin_marcas_principales_', '')
  if (Test-Path $destino) { "Ya existe: $destino" }
  else { Copy-Item $_.FullName $destino; "Copiado:  $destino" }
}
```

Si los bajaste a otra carpeta, cambiá `$HOME\Downloads`.

## 3. Ver qué boletines son nuevos

Los nuevos son los que Git todavía no tiene: los que no se commitearon.

```powershell
$nuevos = git ls-files --others --exclude-standard data/boletines
$nuevos
```

Tiene que listar justo los que copiaste. Si sale vacío, no hay nada para importar.

## 4. (Opcional) Probar contra la base local

Usa el `DATABASE_URL` del `.env`.

```powershell
foreach ($f in $nuevos) { npm run importar-boletin -- $f }
```

## 5. Importar a producción (Neon)

Copiá la connection string del dashboard de Neon y pegala cuando la pida. Con `Read-Host`, la URL no queda en el historial de la terminal.

```powershell
$env:DATABASE_URL = Read-Host "Connection string de Neon"
foreach ($f in $nuevos) { npm run importar-boletin -- $f }
Remove-Item Env:DATABASE_URL
```

**No te saltees el `Remove-Item`**: sin él, la terminal sigue apuntando a producción y cualquier script que corras después escribe en la base real.

Si se corta por la mitad, se puede volver a correr entero. La tabla tiene `UNIQUE (fecha_publicacion, expediente)`, así que no duplica nada.

### Cómo leer lo que imprime

| Línea | Qué significa |
|---|---|
| `Insertadas` | Filas nuevas que entraron. |
| `Ya existían` | Ya estaban cargadas (reimportación). No es un problema. |
| `Con error` | Filas que no pasaron la validación y quedaron afuera; abajo dice fila y motivo. Revisarlas en el buscador de DINAPI. |
| `Alertas nuevas (fecha)` | Alertas generadas contra las marcas de todos los usuarios. No hay que correr nada más. |

## 6. Revisar en la app

- **Boletines DINAPI**: ordená por fecha y fijate que aparezcan los días nuevos.
- **Alertas**: mirá si hay nuevas.

## 7. Commit y push de los CSV

Cambiá las fechas del mensaje.

```powershell
git add data/boletines
git commit -m "agrega boletines del 25 al 27 de noviembre"
git push
```

El aviso *"LF will be replaced by CRLF"* es normal: es solo el fin de línea de Windows y el importador lee los dos formatos. El push hace que Render vuelva a deployar el backend, aunque no haya cambios de código.

---

## Si solo tenés el reporte semanal ("Marcas Recibidas")

Antes del paso 3, convertilo a diarios. No pisa archivos que ya existan:

```powershell
npm run convertir-boletin-semanal -- "$HOME\Downloads\<reporte>.csv" data\boletines
```

El reporte semanal pasa por Excel: el conversor avisa los valores que parecen fechas y propone el valor probable. Verificá cada uno en el buscador de DINAPI y corregí el CSV a mano antes de importar. Si existe el diario, usá siempre el diario.
