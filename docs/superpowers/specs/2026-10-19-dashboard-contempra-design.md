# Dashboard Contempra — Diseño (Spec v1)

Fecha: 2026-10-19 · Estado: borrador para revisión

> Regla de idioma: esta spec está en español para el dueño del proyecto. **Todo texto visible para usuarios finales (UI, mensajes, emails, ayuda) va en inglés.** Los nombres entre `código` son los textos exactos de la UI.

## 1. Objetivo

Dashboard web, mobile-first, para el taller de Contempra. Hace que cada Work Order (docket) fluya por producción con tarjetas por rol, con trazabilidad total (quién y cuándo) y sincronizado en tiempo casi real con el Google Sheet "Workorder Books".

**Éxito =**
- La oficina puede seguir usando la hoja y el dashboard refleja todo en segundos, en ambos sentidos.
- Cada empleado abre su celular y ve solo sus tarjetas, ordenadas por urgencia.
- El Admin crea un docket con varios items y las tarjetas aparecen solas en el rol y la persona correctos.
- Siempre se sabe qué está en producción, qué está en espera, qué se terminó y qué falta facturar.

**Fuera de alcance v1:** las pestañas `Estate`, `Daily Job` y `Clipboard`, y generar la columna F `#` (pendiente de averiguar su uso; solo se muestra).

## 2. Arquitectura

| Pieza | Tecnología | Función |
|---|---|---|
| Frontend | React + Vite + Tailwind, PWA instalable | UI en inglés, mobile-first |
| API | Cloudflare Worker | Login, permisos, lógica de negocio, escritura a la hoja |
| Base de datos | Cloudflare D1 | Espejo de la hoja + usuarios, sesiones, cola de sincronización |
| Tiempo real | Durable Object (WebSocket hub) | Empuja cambios a todos los celulares conectados |
| Sincronización | Google Sheets API (service account) + Apps Script en la hoja + Cron cada minuto | Ida y vuelta casi en tiempo real |

**Google Sheets es la fuente de verdad** de los datos del negocio. D1 es una copia rápida para leer. Lo único que vive solo en D1: contraseñas y sesiones de usuarios, y el estado de la sincronización.

## 3. Estructura de la hoja

Se trabaja primero sobre una **copia de respaldo** del sheet real.

### 3.1 Pestaña `Contempra` (1 fila = 1 docket)
- **A–P no cambian:** Date, Due Date, Work Order, COMP, HOLD, #, Customer, Project, Address, **J = `Account Manager`**, ROLE, Inv, Inv/Date, Quote/PO/Deposit, Notes, LINK.
- **Q en adelante = resumen de producción**, escrito solo por el dashboard:
  `Stage` · `Design` · `Print Roll` · `Print FB` · `Lam Roll` · `Liquid Lam` · `Colex` · `Finishing` · `Assigned` · `Sync ID`
  - Celdas de rol: `—` (no está en la ruta), `Pending`, `In progress – Ana`, `1/2 – Jeff` (items), `✓ Ana 10/19`, `Blocked: File missing`.
  - Si alguien edita a mano estas columnas, el dashboard las corrige con el valor real.
- Antes de reemplazar Q–Y, sus datos actuales se copian a la pestaña `Legacy Q-Y`, con el Work Order como referencia.
- Las órdenes nuevas se insertan **arriba** (fila 2), como hoy. **Las filas se identifican por Work Order, nunca por número de fila.**

### 3.2 Pestañas nuevas
| Pestaña | 1 fila = | Columnas principales |
|---|---|---|
| `Items` | 1 trabajo dentro de un docket | Work Order, Item #, Description, Qty, Route, Status |
| `Production` | 1 tarjeta (item × rol) | Work Order, Item #, Step #, Role, Assigned To, Status, campos de la tarjeta, Notes, y por cada check: valor + By + At |
| `Catalogs` | 1 opción de catálogo | Type (Machine / Roll Print Material / Sheet Material / Lam Material), Name, Active |
| `Users` | 1 empleado | Username, Full Name, Access Level, Roles, Active. **Sin contraseñas** |
| `Activity Log` | 1 cambio | Timestamp, User, Work Order, Item, Field, Old Value, New Value, Source (Dashboard/Sheet) |

La pestaña actual `USERS` guarda contraseñas en texto plano. **Se recomienda borrarla del sheet real.** El dashboard no la usa.

## 4. Reglas de negocio

### 4.1 Estado del docket
En este orden de prioridad:
1. **`Cancelled`:** Due Date o Inv/Date empiezan con "CANCEL" (sin importar mayúsculas).
2. **`Completed`:** COMP marcado.
3. **`On Hold`:** HOLD marcado.
4. **`Active`:** todo lo demás.

Vistas: **Active**, **On Hold** y **History** (Completed + Cancelled, con filtro para cada uno). History es de solo lectura, salvo para el Admin.

### 4.2 Facturación (columna M `Inv/Date`)
- `Billed`: tiene texto (número de factura + fecha) que no es CANCEL ni NO CHARGE.
- `No Charge`: empieza con "NO CHARGE".
- `Not Billed`: vacía.

Sección **Non Billed Jobs**, con dos pestañas:
- `Ready to Bill`: Completed + Not Billed.
- `Open – Not Billed`: Active u On Hold + Not Billed.

Ambas se pueden filtrar por Account Manager y Customer, y muestran la antigüedad (días desde Date o desde que se completó).

### 4.3 Grupos de tiempo (desde `Due Date`)
- `Rush / Today`: texto RUSH, ASAP o NOW, o fecha ≤ hoy. Las vencidas se marcan en rojo como `Overdue`.
- `This Week`: fecha hasta el domingo de esta semana.
- `Coming`: fecha posterior.
- `No Due Date`: vacía, o con texto que no es fecha (ej. "in production", "FLAT"). En este caso se muestra el texto original.

### 4.4 Work Order Number
- Al crear, el dashboard propone `máximo actual + 1`. El Admin puede editarlo.
- **No se permiten duplicados** (validación en el servidor).
- Los duplicados ya existentes (~25) van a la cola `Needs Review` del Admin.

### 4.5 Ruta y tarjetas
- Cada **item** tiene una ruta ordenada de roles, cada paso con una o más personas asignadas.
- Solo la tarjeta del **paso actual** está activa. Las siguientes se ven como `Up next` (solo lectura).
- Al completar un paso se activa el siguiente y se notifica a sus asignados.
- Cuando todos los items terminan su ruta, el dashboard **marca COMP en la hoja** automáticamente. El docket pasa a History y, si no tiene factura, a `Ready to Bill`.
- Si en una tarjeta asignada a varias personas, cualquiera de ellas la completa, queda registrado quién fue.
- Hay **rutas plantilla** guardadas (ej. "Banner", "Coroplast Sign", "Vehicle Wrap") que el Admin gestiona.

**Dockets creados directamente en la hoja** (por la oficina): aparecen en la cola `Needs Routing` para que el Admin les agregue items y ruta.

### 4.6 Trazabilidad
Cada check y cada campo guarda **By** y **At** automáticamente. En la UI se ve así: `Printed ✓ — Jeff · Oct 19, 2:14 PM`. Todo cambio, desde el dashboard o desde la hoja, va al `Activity Log`.

## 5. Tarjetas por rol

**Encabezado común:** `Customer`, `Work Order #`, `Account Manager`, descripción del item, chip del grupo de tiempo, `Item 2 of 3`.

| Rol (UI) | Campos | Completa el paso |
|---|---|---|
| `Designer` | `Sent Proof` ✓ · `Proof Approved` ✓ · `On Hold` (toggle) · `Sent to Production` ✓ · `Note` · `File` (nombre de archivo, texto) | `Sent to Production` |
| `Printer Roll` | `Printed` ✓ · `Material` (catálogo) · `Machine` (catálogo) · `Material Length (ft)` · `Note` · `File Missing` (flag) | `Printed` |
| `Printer FB` | `Printed` ✓ · `Material` (catálogo) · `New Sheet` · `Cut Off` · `Sheets Used` (número) · `File Missing` (flag) | `Printed` |
| `Laminate Roll` | `Laminated` ✓ · `Material` (catálogo) · `Material Length (ft)` · `Notes` | `Laminated` |
| `Liquid Lam` | `Laminated` ✓ · `Notes` | `Laminated` |
| `Colex Finish` | `Completed` ✓ · `Notes` | `Completed` |
| `Finishing / Packaging` | `Grommets` ✓ · `Tape` ✓ · `Packaged` ✓ · `Trimmed` ✓ · `Mounted` ✓ · `I left this job at…` (texto libre) | Botón `Mark Finished` (pide `I left this job at…`) |

- **`File Missing`:** la tarjeta pasa a `Blocked`. Se notifica al Designer y al Account Manager. Se desbloquea cuando el Designer confirma `File fixed`.
- **`On Hold` en Designer:** también marca HOLD en el docket.

## 6. Pantallas

1. **`My Cards`** (inicio para Staff, celular): pestañas por rol si la persona tiene varios. Grupos `Rush / Today` · `This Week` · `Coming` · `No Due Date`. Se abre la tarjeta, se marcan los checks con un toque y se guarda al instante.
2. **`Main Dashboard`** (Admin y Manager): todas las órdenes con búsqueda, filtros (estado, Account Manager, rol, grupo de tiempo, facturación) y vista de tabla o tablero por etapa. Al abrir un docket se ve el detalle completo, sus items, rutas, tarjetas e historial, y se puede editar.
3. **`New Work Order`** (Admin): datos del docket → items → ruta y personas por item → guardar.
4. **`Non Billed Jobs`** (Admin y Manager): `Ready to Bill` / `Open – Not Billed`.
5. **`Admin`**: usuarios (crear, editar, roles, nivel, resetear contraseña, desactivar), roles, catálogos, rutas plantilla, `Needs Review`, `Needs Routing` y estado de la sincronización.

## 7. Usuarios y permisos

- Login con **usuario + contraseña**. Hash PBKDF2 (WebCrypto), sesión en cookie httpOnly, límite de intentos y reseteo de contraseña por el Admin.
- **Admin:** todo.
- **Manager:** ve todo, edita dockets, asigna y reasigna, ve Non Billed. No gestiona usuarios ni catálogos.
- **Staff:** solo sus tarjetas (las de sus roles asignadas a él o ella) y lectura del docket relacionado.
- Un empleado puede tener **varios roles**.

## 8. Sincronización

- **Hoja → D1:** un trigger instalable `onEdit`/`onChange` de Apps Script envía el cambio al Worker (firmado con HMAC) en 1–3 segundos. Además, un **cron cada minuto** concilia la hoja completa (un `batchGet`) como red de seguridad.
- **Dashboard → Hoja:** al guardar se escribe en D1 y en la hoja (`batchUpdate`). Si falla, queda en una cola de reintentos y la UI muestra `Syncing…`.
- **D1 → Celulares:** el Durable Object emite el cambio por WebSocket.
- **Conflictos:** gana el último cambio. El valor anterior queda en el `Activity Log`.
- **Bucles:** los cambios hechos por la API no disparan `onEdit`, así que no hay eco.
- **Límites (según la documentación de Google; reconfirmar al implementar). Deberían alcanzar para un taller:** Sheets API 300 lecturas/min por proyecto; UrlFetch de Apps Script 20.000/día (Gmail) o 100.000/día (Workspace); cron mínimo de 1 minuto.

## 9. Fases

1. **Base:** Worker + D1 + login + usuarios y roles + lectura de la hoja → Main Dashboard (solo lectura) con Active / On Hold / History / Cancelled, grupos de tiempo, Non Billed y Needs Review.
2. **Producción:** pestañas nuevas en la hoja, New Work Order, items y rutas, tarjetas, My Cards en el celular, escritura en la hoja, auto-COMP, WebSocket.
3. **Tiempo real total y extras:** Apps Script instantáneo, Activity Log en la UI, notificaciones, reportes de consumo de material.

## 10. Pendientes del dueño

- Significado de la columna F `#`.
- Qué significan **`New Sheet`** y **`Cut Off`** en Printer FB (¿checks, o tipo de hoja usada: nueva vs. retazo?).
- Listas para los catálogos: máquinas, materiales de impresión roll, materiales de hoja (FB) y materiales de laminado.
- Lista de empleados con sus roles y nivel de acceso.
- Copia de respaldo del sheet y acceso para la service account.
- Dominio deseado (ej. `dashboard.contempra.ca`).
