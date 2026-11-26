# My List + notas personales en un docket

Fecha: 2026-11-26. Rama `feature/my-list-and-notes`. Aprobado de antemano por el dueño (decisiones tomadas aquí).

## 1. My List (seguir dockets)

- Tabla nueva `docket_follows (user_id, work_order, added_at)`, PK `(user_id, work_order)`, migración `0014_my_list_and_notes.sql`. `user_id` con `ON DELETE CASCADE`. Sin FK a `dockets` (es un espejo del Sheet).
- API (admin/manager, igual que el resto de `/api/dockets`):
  - `PUT /api/dockets/:wo/follow` → `{ followed: true }` (idempotente; 404 `Work order not found` si no existe).
  - `DELETE /api/dockets/:wo/follow` → `{ followed: false }` (idempotente).
  - `GET /api/dockets?list=1` → mismo listado filtrado a mis dockets seguidos. Mismas secciones, órdenes, contadores, vistas, búsqueda y filtro de AM.
- Cada ítem de `GET /api/dockets` y `GET /api/dockets/:wo` trae `followed` y `myOpenNotes` del usuario que pide (subconsultas en la misma consulta paginada; sin consultas por tile).
- UI: botón marcador (bookmark) en cada tile y en el encabezado del detalle. Vacío = no lo sigo; relleno = en mi lista. Un toque, sin confirmación, cambio optimista. `aria-label`/tooltip `Add to My List` / `Remove from My List`, `aria-pressed`.
- Selector: `All dockets | My Dockets | My List`, recordado en `localStorage` `dashboard.scope.<id>` (`all | mine | list`).
- My List vacío: `Your list is empty. Tap the bookmark on a docket to add it.`
- Un docket cerrado sigue en la lista (aparece en History). Personal: nadie ve la lista de otro. Sin alertas. No toca el Sheet.

## 2. Notas personales pegadas a un docket

- Reutiliza Task Cards "note to self": `task_cards` gana `work_order TEXT` (nullable) + índice parcial.
- `POST /api/task-cards` acepta `workOrder`. Reglas:
  - Solo una nota a mí mismo (`400 A docket note is a note to self.`).
  - Solo admin/manager (`403 Only managers can add notes to a docket.`): son quienes ven el Main Dashboard.
  - El docket tiene que existir (`404 Work order not found`).
- `GET /api/task-cards?workOrder=X` → mis notas abiertas de ese docket.
- `TaskCardDTO.workOrder: string | null`.
- UI:
  - Botón de nota (icono nota) en el tile y en el encabezado del detalle: abre la misma sticky de New Task Card con `To: Me` fijo (sin Change) y `Docket #WO` vinculado; fecha opcional como siempre.
  - Si tengo notas abiertas del docket, el botón de nota del tile se pinta amarillo con el número (la marquita, solo para mí).
  - El detalle muestra mis notas abiertas como stickies amarillas con Done (Done = igual que hoy: History).
  - My Cards: siguen como Task Cards; el tile muestra `#WO` y la vista abierta tiene un botón `Docket #WO` que abre el detalle del docket. History también muestra `#WO`.
  - New Task Card del dashboard general: igual que hoy ("Me" arriba), sin vínculo.

## Decisiones

- **Staff**: no ve el Main Dashboard ni `/api/dockets`, así que no tiene My List ni notas de docket (el server rechaza `workOrder` de Staff). Su My Cards no cambia. Se puede agregar desde Read Docket más adelante si el dueño lo pide.
- Notas vinculadas = solo a mí mismo (no se mandan a otros): así nunca llega a Staff un enlace a un docket que no puede abrir.
- El marcador y la nota en el tile son botones aparte (el tile pasa a ser un contenedor con un botón que cubre todo; no hay botones anidados).
- Sin limpieza de `docket_follows` al purgar la Trash: el purge no borra de `dockets`, y una fila huérfana no se muestra.
- Polling: nada nuevo; los campos van en la lista que ya se refresca cada 30 s.
