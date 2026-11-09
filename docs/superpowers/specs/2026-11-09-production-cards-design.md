# Tarjetas de Producción — Diseño (Spec v1)

Fecha: 2026-11-09 · Estado: borrador para revisión · Depende de: `2026-10-19-dashboard-contempra-design.md` y `2026-11-05-virtual-docket-design.md`

> Regla de idioma: spec en español; **todo texto visible para usuarios va en inglés**. Los textos entre `código` son los exactos de la UI.

## 1. Objetivo

Que las tarjetas **organicen el trabajo** y no solo lo muestren. Cada docket recorre su ruta de áreas, y en cada área una tarjeta le dice a su equipo qué hacer. La tarjeta no deja avanzar hasta que lo obligatorio está hecho y permite devolver el trabajo con un motivo. Cada movimiento queda registrado con persona, fecha y hora. En el Google Sheet se ve en qué área va cada docket.

**Éxito =**
- Cuando a alguien le llega una tarjeta, se entera: suena, se ve y late.
- Nadie puede saltarse un paso obligatorio.
- Un trabajo con un problema vuelve al área correcta con el motivo escrito.
- Los Managers ven dónde está cada docket y por dónde pasó.
- La hoja muestra el área actual de cada docket (columnas Q–Z).

**Fuera de alcance:**
- Crear las cuentas del personal ("Import from Contributors"). Está en pausa hasta que el dueño diga.
- Notificaciones push con la app cerrada. Puede venir después.
- Sticky Notes y Task Cards, que tendrán su propia spec.

## 2. Roles (cambios)

- **Se agrega** `installer` (`Installer`).
- **Se renombra** `colex_finish` (`Colex Finish`) a `colex` (`Colex`). Colex y Finishing son dos actividades distintas.
- **Orden de los roles** en la UI y en las rutas: Designer · Printer Roll · Printer FB · Laminate Roll · Liquid Lam · Colex · Finishing / Packaging · Installer.

## 3. Rutas y equipos (desde el Docket Virtual)

Cada trabajo (job) del panel **Production** del docket tiene una **ruta ordenada de pasos**, y cada paso tiene un rol más su asignación:

- **Equipo** (por defecto): sin personas elegidas. La tarjeta le aparece **a todos los usuarios activos con ese rol** (ej. "Printer Roll" → Sebastian y Erin). Cualquiera la puede trabajar y queda registrado quién lo hizo.
- **Personas específicas:** solo a las elegidas.

En el chip del paso se ve `Printer Roll · Team` o `Printer Roll · Erin`.

## 4. Ciclo de vida de una tarjeta

1 tarjeta = 1 paso de un job. Estados:

| Estado | Significado |
|---|---|
| `waiting` | Aún no le toca: un paso anterior no terminó. Se ve como `Up next` (solo lectura). |
| `active` | Le toca. Aparece en *My Cards* de su equipo o de sus personas. |
| `done` | Terminada con **Continue**. |

- Al crear o guardar un docket con ruta, el **primer paso** de cada job queda `active` y los demás `waiting`.
- **Docket completo:** cuando el último paso de todos sus jobs queda `done`, se marca COMP en la hoja automáticamente (ya definido en la spec base).

### 4.1 Botones

- **`I'm on it`:** opcional. Marca que alguien la está trabajando, y los demás del equipo ven `Seb is working on it`. Cualquier otro puede tomarla igual; queda registrado.
- **`Continue → <siguiente área>`** (ej. `Continue → Laminate`; en el último paso `Continue → Done`):
  - Está deshabilitado hasta cumplir los campos ★ de su rol (§5). Debajo se explica qué falta: `Mark "Laminated" to continue`.
  - Al pulsarlo, la tarjeta queda `done`, la siguiente pasa a `active` y se notifica al equipo siguiente (§6).
- **`← Send back`:**
  - Abre un selector con **cualquier área anterior** de la ruta y un campo **Reason** obligatorio.
  - La tarjeta destino vuelve a `active` con la franja roja `Returned by <name> · <reason>`.
  - Las tarjetas intermedias vuelven a `waiting`, y se notifica al equipo destino.
  - Los campos ya llenados se conservan. La franja desaparece cuando esa área vuelve a dar Continue.
- **File missing / Cut file missing:** bloquean Continue y muestran el atajo `Send back to Design` con el motivo ya escrito.

### 4.2 Registro (historial)

- **Qué se registra:** cada acción (activada, tomada, campo marcado, Continue, Send back con motivo, docket completado), con persona, fecha y hora.
- **Quién lo ve:** Managers y Admin, en el detalle del docket, pestaña **`History`**. Es una línea de tiempo, por ejemplo: `Nov 9, 2:14 PM · Print Roll · Seb · Continue → Laminate`.

## 5. Campos por rol (★ = obligatorio para Continue)

**Encabezado común** a todas las tarjetas: `Work Order #`, `Customer`, `Account Manager`, nombre del job, grupo de tiempo (Rush / This Week…) y franja de devolución si la hay.

| Rol | Campos |
|---|---|
| **Designer** | ☐ `Sent proof` · ★☐ `Proof approved`, solo si el docket tiene PROOF REQUIRED · ☐ `On hold` (marca HOLD en el docket) · `Note` · `File` (texto, opcional). Su botón dice `Send to production →` |
| **Printer Roll** | ★☐ `Printed` · `Machine` (catálogo) · `Material used` (catálogo) · `Material length (LN FT)` (opcional por ahora) · `Note` · ★`File`: ◉ `OK` / ◉ `Missing` |
| **Printer FB** | ★☐ `Printed` · `Material` (catálogo) · ★ ◉ `New sheet` / ◉ `Cut off`, cada uno con `Size` y `Qty` · `# Sheets used` · `Notes` · ★`File`: ◉ `OK` / ◉ `Missing` |
| **Laminate Roll** | ★☐ `Laminated` · `Material` (catálogo) · `Material length (LN FT)` · `Notes` |
| **Liquid Lam** | ★☐ `Laminated` · `Coating` · `Notes` |
| **Colex** | ★☐ `Completed` · ☐ `Cut file missing` (bloquea) · `Notes` |
| **Finishing / Packaging** | ☐ `Grommets` · ☐ `Tape` + `Kind` · ☐ `Trimmed` · ☐ `Mounted` · ☐ `Ready for vendor pickup` (Sewn Hem & Grommets) · ★`Packaged`: `Almost Ready` → `Ready` → `Shipped` (Continue pide `Ready` o `Shipped`) · ★`I left this job at…` |
| **Installer** | ☐ `Site checked` · ★☐ `Installed` · `Address` (se toma del docket, editable) · `Date` · `Crew` · `Photos` (link) · `Notes` |

**`Ready for vendor pickup`:** al marcarse, el docket aparece en el dashboard de la oficina con la etiqueta `Vendor pickup ready`, para saber cuándo llamar al proveedor.

Los catálogos (máquinas y materiales) salen de la pestaña `Catalogs`. Ya está cargado el de materiales Roll (`data/catalogs/roll-print-materials.json`).

## 6. Notificaciones (imposibles de ignorar)

Cuando una tarjeta pasa a `active` para alguien (llega, se reasigna o se devuelve):
- **Sonido:** una campana corta, generada en el navegador (sin archivos). Se puede silenciar en el perfil con `Sound on/off`.
- **Contador:** badge rojo en negrita en *My Cards* (barra lateral y barra inferior del celular), que **late** hasta abrir la tarjeta.
- **Título de la pestaña:** `(2) New cards · Contempra`.
- **Tarjeta nueva:** brillo y etiqueta `NEW` hasta abrirla.
- **Frecuencia de revisión:** cada **20 segundos** mientras la app está abierta. Cabe en el plan gratis.

Una tarjeta deja de contar como nueva cuando esa persona la abre.

**Límite de los navegadores:** el sonido solo puede sonar después de que la persona haya tocado la página al menos una vez (por ejemplo, al iniciar sesión). Para escuchar avisos sin tener la app abierta hacen falta notificaciones push, que quedan para una fase siguiente (en iPhone requieren instalar la app en la pantalla de inicio).

## 7. Pantallas

- **`My Cards`** (inicio de Staff):
  - Pestañas por rol si la persona tiene varios.
  - Grupos `Returned` (arriba, en rojo) · `Rush / Today` · `This Week` · `Coming` · `No Due Date`.
  - Tarjetas cuadradas con el mismo estilo de vidrio. Al tocar una se abre completa con sus campos y botones.
- **`Production Board`** (Managers y Admin):
  - Una columna por área con su contador (`Laminate (12)`).
  - Filtros por área, persona y grupo de tiempo.
  - Se ven las tarjetas `active` y las devueltas resaltadas.
- **Detalle del docket:** pestañas `Details` · `Production` (estado de cada job y paso) · `History`.

## 8. Google Sheet

### 8.1 Columnas Q–Z (resumen; las escribe solo el dashboard)

| Q | R | S | T | U | V | W | X | Y | Z |
|---|---|---|---|---|---|---|---|---|---|
| `Stage` | `Design` | `Print Roll` | `Print FB` | `Laminate` | `Liquid Lam` | `Colex` | `Finishing` | `Install` | `Assigned` |

- **`Stage`:** área o áreas activas (`Print Roll` o `Print Roll, Colex` si hay varios jobs), o `Done`.
- **Columnas de área:**
  - `—`: no está en la ruta.
  - `Pending`.
  - `Active · Seb` (o `Active · Team`).
  - `Returned · <reason>`.
  - `✓ Seb 11/09`.
  - En Finishing además `Ready` / `Shipped`.
- **`Assigned`:** quiénes tienen tarjetas activas.

**Paso único de preparación**, desde Admin con el botón `Set up production columns` (pide confirmación):
1. Copia las columnas Q–Y actuales a la pestaña `Legacy Q-Y`, con el Work Order de referencia.
2. Escribe los nuevos encabezados Q–Z.

SUB y QC se eliminan; su contenido queda en `Legacy Q-Y`.

### 8.2 Pestaña `Production` (detalle; una fila por tarjeta)

Columnas: `Work Order` · `Job` · `Step` · `Role` · `Assigned To` · `Status` · `Fields` (resumen legible, ej. `Printed ✓ · Machine: HP Latex 800 · Material: IJ35 · 24 ft`) · `Returned Reason` · `Updated By` · `Updated At`.

Se reescribe la fila de la tarjeta en cada cambio. Usa el mismo candado de escritura de la hoja (`withLock("sheet")`).

## 9. Datos (D1, migración 0004)

- **Roles:**
  - Insertar `installer` (sort 8).
  - Renombrar `colex_finish` a `colex` con label `Colex`, actualizando también `user_roles` y `job_steps`.
- **`cards`:**
  - Identificación y estado: `id`, `work_order`, `job_id`, `step`, `role_id`, `status` (`waiting` / `active` / `done`).
  - Asignación: `assignee_ids` (JSON; vacío = equipo), `claimed_by`.
  - Contenido: `fields_json`, `returned_reason`, `returned_by`.
  - Fechas: `activated_at`, `done_at`, `done_by`, `updated_at`.
  - Índices: (`role_id`, `status`) y `work_order`.
- **`card_events`:** `id`, `card_id`, `work_order`, `action` (`activated` / `claimed` / `field` / `continued` / `sent_back` / `completed`), `detail_json`, `user_id`, `at`.
- **`card_seen`:** `user_id`, `card_id`, `seen_at`, para saber qué tarjetas son nuevas para cada persona.
- **`users`:** se agrega `sound_on INTEGER DEFAULT 1`.

**Las tarjetas se crean** al guardar un docket con ruta: una por cada paso de cada job. Si la ruta se edita después, se recalculan los pasos que todavía no están `done`.

## 10. Reglas de servidor (resumen para el plan)

- **Validación de Continue:** las reglas ★ de §5 se validan en el servidor, no solo en la pantalla. Un `Continue` sin cumplirlas responde 409 con el mismo texto que muestra la UI.
- **Quién puede actuar sobre una tarjeta:** los usuarios con el rol y que estén asignados (o cualquiera del equipo si no hay personas elegidas), además de Managers y Admin.
- **`Send back`:** solo a pasos anteriores del mismo job. `Reason` es obligatorio (mínimo 3 caracteres).
- **Concurrencia:** Continue y Send back usan una versión por tarjeta. Si otra persona ya avanzó la tarjeta, el segundo intento responde `This card was already moved by <name>.`.
- **Plan gratis:**
  - *My Cards* hace 1 consulta liviana cada 20 s por usuario conectado (contador + tarjetas).
  - Las escrituras a la hoja ocurren solo en Continue, Send back, Claim y al guardar campos (con 1 s de espera para juntar cambios).

## 11. Pruebas

- **Unitarias:**
  - Reglas ★ por rol: cada rol bloquea y permite según §5.
  - Cálculo de las columnas Q–Z a partir de las tarjetas.
  - Resumen `Fields` para la pestaña Production.
- **Worker:**
  - Continue activa el siguiente paso y notifica.
  - Send back a cualquier paso anterior con motivo; sin motivo responde 400.
  - Equipo frente a personas específicas en *My Cards*.
  - Dos Continue simultáneos: uno pasa y el otro responde 409.
  - Último paso → COMP en la hoja.
  - Migración de roles (renombrar `colex_finish` sin perder asignaciones).
  - `Set up production columns` copia a `Legacy Q-Y` antes de escribir los encabezados.
- **Web:**
  - El botón dice `Continue → Laminate` y está deshabilitado con el texto de lo que falta.
  - Send back pide el motivo.
  - Contador, latido y sonido cuando llega una tarjeta nueva (sonido simulado en la prueba).
  - Historial visible para Managers y no para Staff.
  - Production Board con contadores.
- **Manual:**
  - Recorrido completo de un docket de prueba Design → Print Roll → Laminate → Finishing en la hoja TEST, con dos usuarios del mismo equipo.
  - Revisar el sonido en iPad.
