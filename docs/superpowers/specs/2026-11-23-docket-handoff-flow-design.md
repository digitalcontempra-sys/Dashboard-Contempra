# Flujo de mano en mano (como el docket de papel), STATUS y tracking completo

Fecha: 2026-11-23. Estado: **aprobado por el dueño**; implementado en la rama `feature/handoff-flow` (plan `docs/superpowers/plans/2026-11-23-docket-handoff-flow.md`).
Reemplaza la ruta fija de áreas del spec `2026-11-09-production-cards-design.md` y amplía `2026-11-23-docket-holder-and-tracking-design.md`.

## 1. Idea

Igual que el papel: el jefe crea el docket y se lo da a una persona. Cada persona, al terminar su parte, lo pasa a quien sigue. Si algo hay que arreglar, lo devuelve a quien lo tenía antes. Todo queda anotado con fecha y hora.

## 2. Crear un docket

- Ya no se arma una ruta de áreas. Al crear el docket se elige **la primera persona** (o varias) y, para cada una, **qué debe hacer** (`What to do`).
- La lista de personas está agrupada por área. Quien no tiene área sale en el grupo **Other** (hoy: Ali, Kristy, Danni, Meinrad, Jeff, Diane).
- Si la persona tiene varias áreas, se elige con cuál trabaja ese docket. Si no tiene ninguna, recibe una **tarjeta general** (solo notas).
- La tarjeta muestra los campos (★) del área elegida, como hoy.

## 3. Acciones en la tarjeta

| Botón | Qué hace |
|---|---|
| `I'm on it` | La persona toma el trabajo. STATUS → `In progress`. |
| `Continue →` | Se cumplen los ★ del área, se elige **una o varias personas** de la lista completa (con área si aplica). Mi tarjeta queda hecha; cada persona elegida recibe una tarjeta nueva. Se escribe **qué debe hacer** (`What to do`, texto obligatorio, uno por persona si se divide): sale arriba en la tarjeta de quien lo recibe y en Docket Tracking. |
| `Done` | Termina **solo mi parte**. El docket vuelve automáticamente a **quien lo creó**, con STATUS `Ready to close`. |
| `← Send back` | Con motivo. Devuelve el docket a la persona de quien lo recibí. STATUS → `Returned`. |
| `Close docket` | Solo en la tarjeta `Ready to close` del creador (o Admin/Manager). Marca COMP y el docket pasa a historial. El creador también puede, en vez de cerrar, hacer `Continue` a otra persona. |
| `Restore` | Solo Admin. En un docket cerrado: lo reabre como `Ready to close` para el creador. En una tarjeta hecha por error: la reabre para esa persona. |

### Esperando aprobación (prueba de diseño o sample)

Botones extra en algunas tarjetas:

| Tarjeta | Botón | STATUS mientras espera |
|---|---|---|
| Designer | `Proof sent` | `Waiting for design approval` |
| Printer Roll, Printer FB, Laminate Roll, Liquid Lam | `Sample sent` | `Waiting for sample approval` |

- Al pulsarlo, mi tarjeta queda hecha y el docket vuelve a **quien lo creó**, con ese STATUS. ROLE muestra al creador.
- El creador, cuando el cliente responde:
  - **Aprobado:** `Approved → Continue`: elige la siguiente persona, el área y qué debe hacer (igual que Continue).
  - **Pide cambios:** `← Send back` con motivo, a quien envió la prueba o el sample. STATUS → `Returned`.
- Docket Tracking: `Ira - proof sent, back to Mike - …`, `Mike - approved - …`, `Mike - returned to Ira (Logo bigger) - …`, `Sebastian - sample sent, back to Mike - …`.
- El botón viejo "Send to production →" del diseñador desaparece: todas las tarjetas usan `Continue →`.

**Dividir:** si `Continue` se envía a varias personas, cada una tiene su propia tarjeta. Cada rama, al hacer `Done`, vuelve al creador. El docket solo puede cerrarse cuando ya no queda ninguna tarjeta abierta salvo la del creador.

Se mantienen: 409 si dos personas mueven la misma tarjeta, notificaciones, historial de la tarjeta, Production Board (columnas por área).

## 4. Hoja de cálculo

### Nueva columna STATUS (columna real)

> **Ya hecho y publicado el 2026-11-23** (layout `v5`, `src/worker/sheet/layout.ts`; ver CLAUDE.md). Esta sección y "Mover las columnas sin romper nada" quedan como referencia: la columna ya existe en la hoja TEST. Lo pendiente es el flujo de tarjetas (secciones 2–3), los nuevos estados y las líneas nuevas de Docket Tracking. La traducción de letras usa `sheet/layout.ts` en lugar del módulo `sheetLayout.ts` descrito abajo.

Se inserta una columna **L = STATUS** justo después de K (ROLE). Todo lo que estaba de L en adelante se mueve una columna a la derecha:

| Antes | Después |
|---|---|
| A–K | A–K (igual) |
| — | **L STATUS** |
| L–P (Inv, Inv/Date, Quote/PO/Deposit, Notes, LINK) | M–Q |
| Q–AB (Stage … Photos) | R–AC |

- La inserción la hace **Set up production columns** una sola vez (layout `v5`) con una inserción real de columna (Sheets `insertDimension`), así las fórmulas y filtros de la oficina se ajustan solos.
- Todo el código que lee o escribe columnas por letra se adapta (lectura de filas, guardado del Virtual Docket, sincronización, Q–AB).

### Mover las columnas sin romper nada

**Una sola fuente de verdad para las columnas.** Un módulo nuevo (`src/shared/sheetLayout.ts`) define cada columna por nombre (`workOrder`, `role`, `status`, `inv`, `link`, `stage`, `photos`…) y da su letra y su posición. Ningún archivo vuelve a escribir letras ni posiciones fijas (`"K"`, `r[10]`, `A1:P`, `Q1:AB`).

**El dashboard reconoce los dos órdenes.** Lee la fila 1 (encabezados): si L1 es `STATUS`, usa el orden nuevo; si no, el viejo. Esto evita tres problemas que ya sabemos que van a pasar:
1. Entre publicar y pulsar **Set up production columns**, la hoja sigue con el orden viejo. La sincronización y el guardado de dockets no se pueden romper en ese rato.
2. Cuando se conecte la hoja real "Workorder Books", llega con el orden viejo. Debe funcionar igual hasta que se pulse Set up en ella.
3. Hoy la lectura revisa los encabezados A–P y se detiene si no coinciden (`EXPECTED_HEADERS`). Esa revisión acepta los dos órdenes.

**Sitios que hoy usan letras o posiciones fijas** (todos pasan a usar `sheetLayout`):

| Archivo | Qué usa hoy |
|---|---|
| `src/worker/sheet/mapRows.ts` | encabezados A–P y posiciones `r[0]…r[15]` al leer cada fila |
| `src/worker/sheet/googleClient.ts` | lectura `Contempra!A1:P` |
| `src/worker/sync/incremental.ts` | lecturas `A…:P…` por páginas |
| `src/worker/sync/nightly.ts` | columna C (Work Order) |
| `src/worker/dockets/service.ts` | `readRow` `A:P`, columna C |
| `src/shared/docketForm.ts` | celdas que escribe el Virtual Docket (A, B, G, H, I, J, M–P…) |
| `src/worker/cards/sheetSync.ts` | Q–AB, R–Z por área, AA, AB (fórmula Photos), D/E (COMP/HOLD), K |
| `src/worker/google/sheets.ts` | `clearColumns`, inserción de fila arriba |
| `test/worker/fixtures.ts`, `scripts/import-fixture.mjs`, `scripts/xlsx_to_values.py` | filas de prueba con 16 columnas |

Un test recorre esos archivos y falla si aparece una letra o rango de columna fijo fuera de `sheetLayout.ts`.

**Fuera del dashboard (a revisar por el dueño):** la hoja tiene un menú propio **"Work Order"** (Apps Script) y la extensión **Convert to PDF**. Si alguno escribe o lee columnas por posición (por ejemplo, "la columna L"), se correría también. Antes de pulsar Set up en la hoja real, hay que revisarlos. Si el dueño lo autoriza, Claude los revisa con él.

**Orden de puesta en marcha:**
1. Publicar el código (funciona con los dos órdenes).
2. Comprobar que la sincronización sigue bien con el orden viejo.
3. Pulsar **Set up production columns** en la hoja TEST: inserta L y escribe `STATUS`.
4. Comprobar: guardar un docket, mover una tarjeta, sincronizar.
5. Lo mismo más adelante en la hoja real.

### ROLE (K) y STATUS (L)

- **K:** siempre la(s) persona(s) que tienen el docket ahora. Al cerrarse, quien lo cerró.
- **L:** el estado de cada una, en el mismo orden que K:
  - `Starting`: le llegó y todavía no pulsó `I'm on it`.
  - `In progress`: pulsó `I'm on it`.
  - `Returned`: se lo devolvieron.
  - `Ready to close`: volvió al creador.
  - `Waiting for design approval` / `Waiting for sample approval`: el creador espera la respuesta del cliente.
  - `Done`: docket cerrado.
- Con varias personas: `Sebastian, Ira` / `In progress, Starting`.

### Docket Tracking

Una línea por momento, con fecha y hora de Winnipeg:

```
Mike - created - November 23 2026 - 9:00 AM
Ira - received from Mike - November 23 2026 - 9:00 AM
Ira - started - November 23 2026 - 9:37 AM
Ira - sent to Sebastian (Print 2 banners 3x6) - November 23 2026 - 11:02 AM
Sebastian - received from Ira - November 23 2026 - 11:02 AM
Sebastian - started - November 23 2026 - 11:10 AM
Sebastian - returned to Ira (Wrong size) - November 23 2026 - 11:30 AM
Sebastian - done, back to Mike - November 23 2026 - 2:15 PM
Mike - closed - November 23 2026 - 3:00 PM
Mike - restored - November 24 2026 - 8:05 AM
```

## 5. Dockets que ya existen

Las tarjetas activas de hoy siguen funcionando con los botones nuevos. Las tarjetas en espera de rutas viejas (`Waiting`) se descartan al primer `Continue` (quien continúa elige a la siguiente persona). El historial viejo se conserva.

## 6. Arreglo menor incluido

El diálogo de **Set up production columns** dice lo que realmente va a hacer: primera instalación (copia Q–Y a `Legacy Q-Y`) o actualización (no toca `Legacy Q-Y`).

## 7. Preguntas abiertas

Ninguna por ahora.
