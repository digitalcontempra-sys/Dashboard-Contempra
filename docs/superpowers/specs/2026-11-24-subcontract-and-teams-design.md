# Sub Contract y equipos de Installer: diseño

Estado: aprobado (2026-11-24). Rama `feature/subcontract-and-teams`.

## 1. Área "Sub Contract"

Para cuando un trabajo se manda a hacer afuera.

- Rol `subcontract`, etiqueta **Sub Contract** (rol y área). Va **última**, después de Measure: `roles.sort = 11` (General sigue en 99).
- Color propio: tokens `--area-subcontract` y `--area-subcontract-ink` (AA en los dos temas, el test de contraste lo verifica).
- Aparece en: Send to / Continue, Production Board (columna "Sub Contract", antes de General), leyenda, filtro de áreas, My Cards y Admin → roles.

### Quién

- La migración da el rol a **todos los admins y managers** activos (`access_level IN ('admin','manager')`). Un manager nuevo lo recibe desde Admin → Users.
- **Solo un admin o manager puede enviar un docket a Sub Contract** (al crear el docket o en Continue). El servidor responde 403 `Only a manager can send work to Sub Contract.`; el selector de Staff no muestra el grupo Sub Contract.

### Campos de la tarjeta (en este orden)

| Campo | Tipo | Obligatorio |
|---|---|---|
| Subcontractor | texto (nombre) | **sí** ★ |
| Work sent | texto (qué se mandó a hacer) | **sí** ★ |
| Sent out | calendario | no |
| Expected back | calendario | no |
| Received back | casilla | **sí** ★ |
| Notes | texto | no |

- Sin campo de costo: los precios nunca están en las tarjetas.
- Bloqueos de Continue / Done: `Mark "Received back" to continue`; un texto obligatorio vacío → `Fill in "Subcontractor" to continue` (regla genérica nueva para textos ★; los mensajes propios de Print FB y Finishing van antes y no cambian).

### Hoja de Google: layout `v7`

- Nueva columna **Sub Contract** después de Measure:
  `Stage | Design | Print Roll | Print FB | Laminate | Contour Cut | Liquid Lam | Colex | Finishing | Install | Measure | Sub Contract | Assigned | Photos` (lógicas Q–AD; con STATUS, físicas R–AE).
- `PRODUCTION_COLUMNS_VERSION = "v7"`. El upgrade en sitio de siempre: Set up reescribe los encabezados, limpia Q–AD y vuelve a escribir todo desde las tarjetas.
- **Después de publicar, el dueño pulsa Admin → Set up production columns** una vez. Hasta entonces, las escrituras quedan en cola.

## 2. Equipos de Installer (Team A, Team B)

No son áreas: son cuadrillas de Installer, usan la columna Install.

### Datos (migración `0011_subcontract_and_teams.sql`)

- `teams (id, name UNIQUE, role_id DEFAULT 'installer', created_at)` y `team_members (team_id, user_id)`.
- `cards.team_id` (nullable, `ON DELETE SET NULL`): la tarjeta recuerda de qué equipo es.
- Semilla: **Team A** = George Inch (`george.i`); **Team B** = Gary (`gary`) + Dennis (`dennis`). Un usuario que no exista se ignora.

### Admin → Teams

- Sección nueva en la página Admin → Users: lista de equipos con sus miembros; **New team**, **Edit** (nombre + miembros) y **Delete**.
- Los miembros se eligen entre las personas activas con rol Installer; un equipo necesita nombre y al menos un miembro.
- API: `GET /api/teams` (cualquier sesión, para el selector), `POST /api/teams`, `PUT /api/teams/:id`, `DELETE /api/teams/:id` (solo Admin).
- Borrar un equipo no toca sus tarjetas abiertas (siguen con sus personas); solo pierden la etiqueta de equipo.

### Send to

- El selector "Send to" (docket nuevo y Continue) muestra un grupo **Teams** primero: `Team B — Install`.
- Enviar a un equipo crea **una sola tarjeta Installer** con todos sus miembros en `assignee_ids` (la lista del momento) y `team_id`.
- Aparece en My Cards de cada miembro (con alerta), con la etiqueta del equipo.
- **I'm on it**: la toma el primero. Desde ahí solo esa persona (o un admin/manager) puede moverla; otro miembro que pulse I'm on it recibe 409 `<Name> is already on it.` Los demás la siguen viendo con "<Name> is on it" hasta que se mueve.
- **Done / Continue / Send back / Proof sent**: la tarjeta deja de estar activa y desaparece para todo el equipo.
- Send back a una tarjeta de equipo: la tarjeta se estaciona y, si el docket vuelve al mismo equipo, se reutiliza (por `team_id`).

### Hoja y seguimiento

- K (ROLE) y Assigned: quien la tomó; si nadie, el nombre del equipo (`Team B`).
- Docket Tracking: `Team B - received from Mike - …`, `Mike - sent to Team B (install sign) - …`, `Gary - started - …`.
- Pestaña Production, "Assigned To": igual que K.

## Decisiones tomadas por Claude

- Equipos solo de Installer (`role_id` queda en la tabla por si un día hay equipos de otra área, sin UI para eso).
- La lista de miembros se copia en la tarjeta al enviarla; cambiar el equipo después no cambia tarjetas ya enviadas.
- La sección Teams vive dentro de Admin → Users (sin página ni menú nuevos).

## Fuera de alcance

- Datos estructurados del subcontratista (lista de proveedores, costos, contacto).
- Equipos para otras áreas.
