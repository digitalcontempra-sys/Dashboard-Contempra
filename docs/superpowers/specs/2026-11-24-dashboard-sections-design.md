# Secciones y orden del Main Dashboard (diseño)

Fecha: 2026-11-24 · Rama: `feature/dashboard-sections`

## Objetivo

1. **New Orders**: guardar un docket con solo el cliente y una nota, para completarlo después.
2. **Daily Complete**: ver los dockets terminados en producción que esperan entrega al cliente.
3. Un orden claro por sección.
4. Quitar **Coming** (nunca se usa).

## Respuestas del dueño

- (a) Sin Coming, **This Week pasa a llamarse `Upcoming`** y muestra todo lo futuro (después de hoy), el que vence primero arriba.
- (b) **Close docket = entregado al cliente.** La facturación sigue aparte (Inv / Non-billed).
- La nota del New Order va en la **descripción del docket** (`body`, que el Sheet resume en Project, columna H). No hay campo nuevo.
- **Save sigue como hoy**: se puede guardar sin asignar personas; ese docket va a las secciones por fecha, sin cards.

## Secciones (vista Active y On Hold)

Chips, en este orden: `All` · `Rush / Today` · `Upcoming` · `New Orders` · `No Due Date` · `Daily Complete`.

Cada docket cae en **una sola** sección (partición; `All` las suma todas), con esta prioridad:

| Sección | Regla | Orden |
|---|---|---|
| `New Orders` | `virtual_dockets.new_order = 1` | más nuevo arriba (Date desc, WO desc) |
| `Daily Complete` | la card del creador está activa en `Ready to close` (sin `returned_reason`) y no hay otra card activa | el que lleva más tiempo esperando arriba (`activated_at` de la card del creador, asc) |
| `Rush / Today` | RUSH/ASAP/NOW o Due Date ≤ hoy | RUSH sin fecha primero, luego Due Date asc (vencidos arriba) |
| `Upcoming` | Due Date > hoy | Due Date asc |
| `No Due Date` | sin Due Date | más nuevo arriba (Date desc, WO desc) |
| `All` | todas | por fecha de creación, más nuevo arriba (Date desc, sin fecha al final, WO desc) |

- History no cambia (WO desc).
- El parámetro de URL sigue siendo `bucket` (`rush_today`, `upcoming`, `new_orders`, `no_due_date`, `daily_complete`). Un valor viejo (`this_week`, `coming`) da 400 en la API; la web lo ignora y muestra All.
- Colores: Upcoming usa el ámbar de This Week; New Orders el azul que tenía Coming (tokens renombrados `--new-order`); Daily Complete el verde `ok`.
- El tile muestra la etiqueta de su sección en lugar de la de fecha (Overdue sigue ganando en Rush). En Daily Complete muestra además `Ready since <fecha>`.

## `TimeBucket` en toda la app

Decisión: `TimeBucket` pasa a `rush_today | upcoming | no_due_date` en toda la app (My Cards, Production Board y Task Cards también pierden Coming y renombran This Week a Upcoming). Un solo vocabulario; Coming no se usaba. Las secciones `new_orders` y `daily_complete` existen solo en el Main Dashboard (tipo `DashSection`).

## Save as New Order

- Botón **`Save as New Order`** en el editor, junto a Save, solo mientras el docket no está en producción (nuevo, o guardado sin cards).
- Requisitos: FOR (cliente) y descripción no vacía. Si no, el servidor da 400 `Write what's missing in the description (for example, waiting for measurements).`; la UI desactiva el botón.
- Si `Send to` tiene a alguien, el botón se desactiva (tooltip `Clear Send to to save as a new order.`): un New Order no se asigna.
- API: `POST /api/virtual-dockets` y `PUT /api/virtual-dockets/:wo` aceptan `newOrder: true`. No se combina con `handoff` ni con una ruta vieja `jobs` (400 `A new order is saved without Send to.`). En un docket con cards: 409 `This docket is already in production.`
- Guarda en D1 `virtual_dockets.new_order = 1` (migración `0012_new_orders.sql`) y pone el docket en la cola del Sheet.
- **Sheet**: con `new_order = 1` y sin cards, K = nombre del creador y STATUS = `Waiting for more info`. Docket Tracking recibe la línea `created` como siempre.
- **Salida**: el flag se borra cuando el docket se asigna (Save con `Send to`, que crea las cards). Un Save normal sin personas lo deja en New Orders. Cancelar o mandar a Trash lo saca por el estado (decisión: el flag y el STATUS del Sheet quedan como estaban; Inv/Date ya dice CANCEL).
- History no calcula secciones (ahorra lecturas de D1).
- **Editar fácil**: en el Main Dashboard, un tile de New Order abre directamente el editor (Edit Docket), no el detalle. El editor muestra `New order · waiting for more info` bajo el título.
- `VirtualDocketDTO.newOrder: boolean`.

## Daily Complete

- Entra cuando el último pulsa Done y la card vuelve al creador en `Ready to close` (ya existe).
- Sale cuando el creador pulsa `Close docket` (COMP → History) o cuando la card cambia de estado (Continue, Send back…).
- Una aprobación pendiente (`Waiting for design/sample approval`) **no** es Daily Complete.

## Fuera de alcance

- Cambios en Close docket, facturación o notificaciones.
- New Orders para Staff (el Main Dashboard es de Admin/Manager).

## Pruebas

- Shared: `deriveTimeBucket` con 3 valores; orden de secciones.
- Worker: `listDockets` por sección (partición, conteos, orden de cada sección y de All); create/update con `newOrder` (validación, flag, se borra con hand-off, 409 con cards); `stageRowCells` con New Order (K + STATUS).
- Web: chips del dashboard, tile de New Order abre el editor, botón Save as New Order (habilitado/deshabilitado, body enviado).
