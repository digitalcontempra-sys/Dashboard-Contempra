# Colores por área y Task Cards — Diseño (Spec v1)

Fecha: 2026-11-10 · Estado: borrador para revisión · Depende de: `2026-11-09-production-cards-design.md`

> Regla de idioma: spec en español; **todo texto visible para usuarios va en inglés**. Los textos entre `código` son los exactos de la UI.

## 1. Objetivo

- **Ver de un vistazo en qué área está cada trabajo.** Cada área tiene un color fijo, que aparece en las tarjetas de producción, el Production Board y el Main Dashboard. El Main Dashboard muestra, en cada docket, el área en la que va ahora.
- **Notas rápidas entre personas (Task Cards).** Cualquiera puede enviar una nota a una persona. Le aparece en *My Cards* como una tarjeta amarilla con botón `Done`. No crea un docket ni pertenece a un área.

**Éxito =**
- Alguien que mira una tarjeta o un docket sabe su área por el color, sin leer.
- El Main Dashboard dice en qué área va cada docket, sin abrir el Production Board.
- Una Task Card enviada llega con aviso. Quien la envía ve cuándo se completó.

**Fuera de alcance:**
- Task Cards para varias personas a la vez (se envía una por persona).
- Escribir Task Cards en el Google Sheet.
- Comentarios o respuestas dentro de una Task Card.

## 2. Colores por área

| Área | Rol | Color | Token |
|---|---|---|---|
| `Design` | designer | Violeta | `--area-design` |
| `Print Roll` | printer_roll | Azul | `--area-print-roll` |
| `Print FB` | printer_fb | Cian | `--area-print-fb` |
| `Laminate` | laminate_roll | Verde azulado | `--area-laminate` |
| `Contour Cut` | contour_cut | Verde | `--area-contour-cut` |
| `Liquid Lam` | liquid_lam | Ámbar | `--area-liquid-lam` |
| `Colex` | colex | Naranja | `--area-colex` |
| `Finishing` | finishing | Rosa | `--area-finishing` |
| `Install` | installer | Café | `--area-install` |

- **Reglas de color:**
  - Rojo (marca, alertas y devoluciones) y amarillo (Task Cards) **no** se usan para áreas.
  - Cada token tiene una variante clara para fondos y se redefine para modo oscuro, con contraste AA en el texto de las etiquetas.
- **Componente común** `AreaChip` (etiqueta del área con su color), usado en todos lados.
- **Dónde se ve:**
  - Tile de tarjeta de producción: borde izquierdo de 4 px del color y `AreaChip`.
  - Tarjeta abierta: `AreaChip` en el encabezado.
  - Production Board: punto de color en el encabezado de cada columna.
  - Pestaña Production del detalle del docket: `AreaChip` en cada paso.
- **Leyenda** en el Main Dashboard, debajo de `+ New Docket` y `New Task Card`:
  - Título `Areas` y la lista de los 9 `AreaChip`, en orden de producción.
  - En pantallas angostas se pliega en una fila con scroll horizontal dentro del bloque, sin scroll de la página.

## 3. Área actual en el Main Dashboard

- **Datos:** el listado de dockets (`GET /api/dockets`) agrega `areas: string[]` (ids de rol de las tarjetas `active` del docket, sin repetir y en orden de producción) y `productionDone: boolean` (todas las tarjetas del docket están `done`).
  - Solo dockets con tarjetas; los demás devuelven `areas: []` y `productionDone: false`.
- **Tile del docket:** muestra un `AreaChip` por área activa, o `Done` cuando `productionDone`. Si no tiene ruta, no muestra nada.
- **Actualización:** la lista del Main Dashboard se refresca sola cada **30 s** (una consulta; cabe en el plan gratis).

## 4. Task Cards

### 4.1 Crear

- **Botón `New Task Card`:**
  - En el Main Dashboard, debajo de `+ New Docket`.
  - En *My Cards*, en el encabezado, para todos los niveles (el Staff no tiene Main Dashboard).
- **Formulario** (modal):
  - `To`: lista de usuarios activos con buscador; no permite elegirse a uno mismo.
  - `Note`: texto obligatorio, de 1 a 1000 caracteres.
  - `When` (opcional): `Rush` · `Today` · `Date` (con selector de fecha) · nada (`No Due Date`).
  - Botón `Send`.
- **Quién puede:** cualquier usuario con sesión iniciada.

### 4.2 Recibir

- En *My Cards* de quien la recibe aparece una **tarjeta amarilla clara** (`--task-bg`), distinta de las de docket:
  - Encabezado `Task` con `From <name>`.
  - La nota, recortada en el tile y completa al abrirla.
  - El grupo de tiempo.
- Se agrupa con las de docket en los mismos grupos:
  - `Rush` → `Rush / Today`.
  - `Today` y fechas de hoy o anteriores → `Rush / Today`.
  - Esta semana → `This Week`; después → `Coming`; sin fecha → `No Due Date`.
- **Aviso:** igual que una tarjeta de docket nueva (campana, contador que late, título de la pestaña y `NEW`) hasta que se abre.
- **Al abrirla:** se ve la nota completa, quién la envió y cuándo, y el botón **`Done`**. Al marcarla, desaparece de su *My Cards*.

### 4.3 Filtro de My Cards

- Opciones: `All` (por defecto) · `Docket cards` · `Task cards` · `Sent by me`.
- **`Sent by me`:** las Task Cards que la persona envió, más recientes primero, con estado:
  - Abiertas: `Open`.
  - Completadas: `Done ✓ · <name> · <fecha y hora>`, en hora de Winnipeg.
  - Mientras sigan abiertas, quien las envió las puede borrar con `Delete`, previa confirmación.
- **Junto a las pestañas de rol:** el filtro se combina con ellas. Las pestañas de rol solo afectan a las tarjetas de docket.

### 4.4 Aviso al completarse

- Cuando el destinatario marca `Done`, quien la envió recibe un **aviso suave**:
  - El contador de *My Cards* sube, sin campana.
  - La tarjeta aparece como `Done ✓` en `Sent by me` hasta que la ve; abrir `Sent by me` las marca como vistas.

## 5. Datos (D1, migración 0007)

- **`task_cards`:**
  - Personas: `id`, `from_user` (FK users), `to_user` (FK users).
  - Contenido: `note` TEXT.
  - Fecha: `due_kind` (`none` / `rush` / `today` / `date`), `due_date` (YYYY-MM-DD o NULL).
  - Estado: `status` (`open` / `done`).
  - Marcas de tiempo: `created_at`, `seen_at` (destinatario), `done_at`, `done_seen_at` (quien envía).
  - Índices: (`to_user`, `status`) y (`from_user`, `created_at`).
- **El grupo de tiempo** se calcula al leer, con `deriveTimeBucket`:
  - `rush` y `today` → `Rush / Today` (`today` usa la fecha del día en que se creó).
  - `date` → por fecha.

## 6. API

| Método y ruta | Quién | Qué hace |
|---|---|---|
| `POST /api/task-cards` `{toUserId, note, due: {kind, date?}}` | cualquiera | Crea la tarjeta. 400 si la nota está vacía o tiene más de 1000 caracteres, si se envía a sí mismo, si el destinatario no existe o está inactivo, o si la fecha no es válida. |
| `GET /api/task-cards?box=inbox` | cualquiera | Las abiertas que recibió. |
| `GET /api/task-cards?box=sent` | cualquiera | Las que envió: las abiertas y las completadas de los últimos 30 días. |
| `POST /api/task-cards/:id/seen` | destinatario | Marca `seen_at`. |
| `POST /api/task-cards/:id/done` | destinatario | `status = done` y `done_at`. 409 si ya estaba completada. |
| `POST /api/task-cards/sent/seen` | quien envía | Marca `done_seen_at` en todas sus completadas. |
| `DELETE /api/task-cards/:id` | quien envía | Solo si sigue `open`; si no, 409. |

- **`GET /api/my-cards/summary`** agrega:
  - `newTasks`: recibidas abiertas sin `seen_at`. Cuentan dentro de `newCount`, así que suena la campana.
  - `doneTasks`: enviadas completadas sin `done_seen_at`. **No** cuentan en `newCount`.
  - El contador muestra `newCount + doneTasks`; la campana suena solo cuando sube `newCount`.

## 7. Pruebas

- **Unitarias:**
  - Grupo de tiempo de cada `due_kind`.
  - Orden de las áreas y que todas tengan color asignado.
- **Worker:**
  - Crear (con sus validaciones) y verla en el inbox del destinatario y en el sent del remitente.
  - Solo el destinatario puede marcar `Done` y solo el remitente puede borrar; 403 para cualquier otro.
  - `summary`: `newCount` incluye las tareas nuevas y `doneTasks` cuenta las completadas no vistas.
  - Listado de dockets con `areas` y `productionDone`.
- **Web:**
  - Leyenda con 9 áreas en el Main Dashboard.
  - Tile de docket con chips de área.
  - Tile de tarjeta con borde y chip de color.
  - Modal `New Task Card` (buscador, validación, envío).
  - Tarjeta amarilla en *My Cards* con `Done`.
  - Filtro con sus cuatro opciones.
  - `Sent by me` con estado y `Delete`.
  - Aviso suave: el contador sube sin campana.
- **Manual:**
  - Enviar una Task Card entre dos cuentas y marcar `Done`.
  - Ver los chips de área en el Main Dashboard después de un Continue.
