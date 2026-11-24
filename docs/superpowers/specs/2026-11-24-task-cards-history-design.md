# Task Cards: History y notas para mí mismo

Fecha: 2026-11-24. Rama `feature/task-cards-history`. Aprobada de antemano por el dueño (decisiones anotadas aquí).

## 1. History

- My Cards → filtro Show gana una pestaña **History** al final: `All / Docket cards / Task cards / Sent by me / History`.
- Muestra las Task Cards en estado `done` donde yo soy el que envía o el que recibe, ordenadas por `done_at` de la más reciente a la más vieja (desempate por `id` desc).
- **Todo el historial, por páginas** (decisión del dueño): 50 por página, botón `Show more` mientras haya más.
- Cada fila lleva una etiqueta clara:
  - `Sent by me`: la envié yo a otra persona. Texto `To <name>`.
  - `Sent by <name>`: me la envió otra persona (antes `Sent to me` + `From <name>`; el dueño pidió el nombre en la etiqueta).
  - `Note to self`: me la envié a mí mismo.
  - Debajo, la nota y `Done ✓ · <fecha y hora Winnipeg>`.
- API: `GET /api/task-cards?box=history&page=N` (N desde 1) → `{ items: TaskCardDTO[], hasMore: boolean }`. Usa los índices existentes (`to_user, status` y `from_user, created_at`); el volumen es bajo.
- Ver History no limpia alertas (eso sigue siendo `Sent by me`).

## 2. Notas para mí mismo

- El selector `To` de New Task Card muestra primero la opción **`Me (<full name>)`** (también aparece al buscar mi nombre o "me").
- El servidor ya no rechaza `toUserId === me.id`.
- Se ve como nota personal:
  - En el tile: etiqueta `Note` (en vez de `Task`) y línea `Note to self`. Mismo amarillo.
  - En la vista abierta: `Note to self · <hora>`; botones `Delete` y `Done`.
  - En el formulario, el botón dice `Save` (en vez de `Send`) y el aviso dice `Note saved`.
- Sin alertas raras:
  - Al crearla se guarda `seen_at = created_at`: nunca es "NEW", no suma al badge ni hace sonar el chime.
  - Al marcarla Done se guarda `done_seen_at = done_at`: no hay alerta "done" para el que la envió (yo).
- No aparece en `Sent by me` (esa lista es para tareas a otras personas). Sí aparece en `Task cards`/`All` mientras está abierta, en su grupo de tiempo, y en History cuando está Done.
- Borrar: el dueño de la nota puede borrarla mientras está abierta (misma regla de hoy: solo quien envía borra, solo abiertas).

## 3. Fuera de alcance

- Sin migración: la tabla `task_cards` ya sirve.
- Sin cambios para Docket cards.
