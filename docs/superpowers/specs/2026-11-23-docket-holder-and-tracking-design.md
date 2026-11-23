# Quién tiene el docket (columna K) y pestaña "Docket Tracking"

Fecha: 2026-11-23. Rama: `feature/docket-holder-tracking`.

## 1. Admin Cory

Sin código. El dueño lo crea en **Admin → Users** con nivel Admin.

## 2. Columna K (ROLE) = quién tiene el docket ahora

En cada escritura de tarjetas a la hoja (`flushCardSheet`), la columna K de la fila del docket (tab `Contempra`) se reescribe así:

- **Tarjetas activas:** por cada tarjeta activa, el nombre de quien la tomó (`I'm on it`). Si nadie la tomó, los nombres de las personas asignadas. Si no hay personas, el nombre del área (ej. `Printer Roll`). Varios valores, sin repetir, separados por `, ` (ej. `Ira, Erin`).
- **Todas las tarjetas hechas:** `Done`.
- **Docket sin tarjetas:** K no se toca.

El texto escrito a mano en K se reemplaza en cuanto el docket tiene tarjetas (aprobado por el dueño). El espejo D1 (`role_note`) se actualiza solo, porque el flush ya relee la fila.

La columna AA (Assigned) no cambia.

## 3. Pestaña nueva "Docket Tracking"

Una fila por docket:

| A | B | C |
|---|---|---|
| Work Order | Customer | Tracking |

`Tracking` es una sola celda con una línea por evento, en orden cronológico (hora de Winnipeg):

```
Ira - received - November 23 2026 - 9:37 AM
Ira - started - November 23 2026 - 9:52 AM
Erin - received - November 24 2026 - 7:45 AM
```

- **received:** la tarjeta llega a alguien (evento `activated`: primera tarjeta al crear la ruta, `Continue`, `Send back`). También cuando, en el editor de ruta, se cambian las personas asignadas a una tarjeta ya activa. El nombre son las personas asignadas en ese momento (separadas por `, `). Si no hay personas, el área.
- **started:** alguien pulsa `I'm on it` (evento `claimed`). El nombre es esa persona.

Para saber a quién llegó, los eventos `activated` nuevos guardan `assignees` (ids) en `detail_json`. Los eventos viejos sin ese dato muestran el área.

La fila se localiza por Work Order (nunca por número cacheado), se actualiza en sitio o se agrega al final. Se escribe en el mismo flush y con el mismo lock que el resto.

`Legacy Q-Y` no se toca.

## 4. Puesta en marcha

- Se sube `PRODUCTION_COLUMNS_VERSION` a `v4`. La ruta de actualización existente, además, crea la pestaña `Docket Tracking` con sus encabezados.
- Tras publicar, el dueño pulsa **Admin → Set up production columns** una vez. Hasta entonces las escrituras quedan en cola (comportamiento actual). Al pulsarlo, todos los dockets con tarjetas se reescriben, así K y el tracking se llenan con el historial existente.

## 5. Tests (primero)

- `stageRowCells`: K con persona que tomó, con asignados, con área, varios sin repetir, `Done`, sin tarjetas → sin K.
- Formato de línea de tracking y orden cronológico, hora de Winnipeg (AM/PM).
- Flush: crea/actualiza la fila de `Docket Tracking` por Work Order.
- `activated` guarda `assignees`; reasignar una tarjeta activa registra `received`.
- Setup v3 → v4 crea la pestaña sin tocar `Legacy Q-Y`.
