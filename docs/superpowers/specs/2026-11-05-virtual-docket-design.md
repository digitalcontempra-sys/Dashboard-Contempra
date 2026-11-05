# Docket Virtual — Diseño (Spec v1)

Fecha: 2026-11-05 · Estado: borrador para revisión · Depende de: `2026-10-19-dashboard-contempra-design.md`

> Regla de idioma: spec en español; **todo texto visible para usuarios va en inglés**. Los textos entre `código` son los exactos de la UI.

## 1. Objetivo

Reemplazar el docket de papel por una **réplica digital idéntica** que se llena en el computador de oficina o en un **iPad en el front desk**, sin cambiar la costumbre del equipo. Al guardar:
1. Se escribe la fila del docket en el Google Sheet, con las mismas columnas que hoy.
2. Se guarda el docket completo en el dashboard.
3. Se genera un **PDF idéntico al papel**, guardado en el dashboard y copiado a Google Drive.

**Un solo camino para la información:** venga de la hoja o del portal, todo docket termina como fila del Sheet, y la misma sincronización lo organiza igual.

**Éxito =**
- El front desk llena un docket en el iPad igual que en papel.
- El docket aparece al instante en el dashboard y en la hoja.
- Su PDF se puede abrir desde el dashboard y desde Drive.
- Se puede editar, cancelar, borrar a papelera y restaurar.

**Fuera de alcance de esta spec** (vienen después, cada una con su spec): Sticky Notes, Task Cards, la UI de tarjetas de producción por rol y firmas a mano alzada.

## 2. Prerrequisito: conectar Google (cuenta Gmail del dueño de la hoja)

La empresa usa **Gmail normal**, no Workspace. Una cuenta de servicio no puede guardar archivos en Drive de Gmail, así que el dashboard se conecta con **OAuth de la cuenta Google dueña de la hoja**, autorizada una sola vez. Esto **reemplaza la cuenta de servicio** de la spec anterior, también para la sincronización.

- **Admin → `Google Connection`:**
  - Botón `Connect Google` (flujo OAuth web).
  - Campo `Google Sheet URL` (de ahí se extrae el ID de la hoja).
  - Estado `Connected as <email>` y botón `Disconnect`.
- **Scopes:**
  - `https://www.googleapis.com/auth/spreadsheets` (leer y escribir la hoja).
  - `https://www.googleapis.com/auth/drive.file`: el dashboard solo ve los archivos que él mismo crea.
- **Carpeta en Drive:** al conectar se crea `Contempra Dockets/`. Dentro, una subcarpeta por año (`2026/`) y un archivo por docket (`91488 - Encore Lounge.pdf`).
- **Tokens:**
  - El refresh token se guarda en D1 **cifrado con AES-GCM**, con la clave del secreto `TOKEN_KEY`.
  - Secretos del Worker: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOKEN_KEY`.
- **El proyecto OAuth de Google Cloud** lo crea el dueño, con instrucciones paso a paso. Debe quedar publicado **"In production"**: en modo "Testing" Google vence los refresh tokens cada 7 días. Google mostrará una advertencia de "app no verificada" la única vez que se autoriza; es normal para una app interna.
- **`isSheetConfigured`** pasa a significar "hay conexión de Google activa y una hoja elegida". `SHEET_ID` y `GOOGLE_SA_JSON` dejan de usarse.

## 3. El formulario (réplica del papel)

**Lienzo:** una "hoja" con proporción carta (8.5 × 11), centrada, que escala al ancho disponible. Encabezado `CONTEMPRA SIGNS`, mismas cajas, mismo orden y mismas etiquetas que el papel.

| Zona | Campos (etiquetas exactas del papel) | Tipo de control |
|---|---|---|
| Encabezado | `Quote #` · `Work Order #` | texto · automático, no editable |
| Fila 1 | `DATE` · `REQUIRED` | fecha (hoy por defecto) · fecha **o** chips `RUSH` / `ASAP` / `NOW` (los textos que el dashboard ya reconoce como Rush) |
| Cliente | `FOR` · `ADDRESS` · `CONTACT` · `PHONE` · `FAX` · `EMAIL` | texto (`FOR` obligatorio) |
| Caja derecha | `P.O. No.` · `INVOICE No.` · `ORDER TAKEN BY` · `SALESPERSON` | texto · texto · usuario actual por defecto · lista de Account Managers + texto libre |
| Checks | `C.O.D.` · `Charge` · `New Account` · `Repeat` | checkbox |
| Cuerpo | `QUANTITY • COLOUR • SIZE • MATERIALS • SINGLE/DOUBLE SIDED` + `PROOF REQUIRED` | **un área de texto libre grande** (sin estructura, crece con el contenido) + checkbox |
| Labour | tabla `NAME` · `WORK` · `HRS.` · `DATE` (8 filas) | texto · texto · número · fecha |
| Materials | tabla `MATERIALS` · `COST` (7 filas) | texto · moneda |
| Saved as | `SAVED AS` | texto |
| Totales | `TOTAL` · `DELIVERY` · `G.S.T. No.` · `P.S.T. No.` · `SUB-TOTAL` · `DEPOSIT` · `GRAND TOTAL` | se calculan (ver abajo) |
| Pie | `INSTALLATION` · `DELIVERY` · `SERVICE` · `PICKUP` · `CALL WHEN READY` · `GOODS RECEIVED BY` | chips (selección múltiple) · checkbox · texto |

**Totales:**
- `TOTAL` = suma de `COST`, editable.
- `DELIVERY` es manual.
- `SUB-TOTAL` = `TOTAL` + `DELIVERY`.
- GST 5 % y PST 7 % (Manitoba), editables.
- `GRAND TOTAL` = `SUB-TOTAL` + GST + PST.
- `DEPOSIT` es manual y se muestra `Balance due`.

**Precios** (Materials/Cost y Totales): **solo Admin y Manager**. Para Staff, la API no los envía y la zona aparece vacía, tanto en pantalla como en su PDF.

**iPad / táctil:**
- Campos de al menos 44 px y teclado numérico en montos y horas.
- Autoguardado del borrador cada 5 s en el dispositivo (`localStorage`), para no perder el trabajo si se cierra la app.
- Uso vertical y horizontal: ≥ 1180 px pone el panel Production al lado del papel; por debajo, lo pone debajo.

**Panel `Production`** (al lado del papel, **no sale en el PDF**):
- Un trabajo por defecto, `Whole docket`.
- Cada trabajo tiene `Job name`, la ruta (chips de roles en orden) y las personas de cada paso, filtradas por quienes tienen ese rol.
- `+ Add job` para trabajos con caminos distintos.
- Las rutas se guardan para las tarjetas de producción de la siguiente spec.

## 4. Mapeo a la hoja `Contempra` (columnas A–P)

| Col | Hoja | Desde el formulario | Al crear | Al editar |
|---|---|---|---|---|
| A | Date | `DATE` | escribe | escribe |
| B | Due Date | `REQUIRED` (fecha o `RUSH`/`ASAP`/`NOW`) | escribe | escribe |
| C | Work Order | automático | escribe | nunca cambia |
| D / E | COMP / HOLD | — | `FALSE` | no toca |
| F | # | — | vacío | no toca |
| G | Customer | `FOR` | escribe | escribe |
| H | Project | resumen del cuerpo: primeras líneas no vacías unidas con ` / `, máx. 200 caracteres | escribe | escribe |
| I | Address | `ADDRESS` | escribe | escribe |
| J | Account Manager | `SALESPERSON` (iniciales) | escribe | escribe |
| K | ROLE | — | vacío | no toca |
| L | Inv | — | `FALSE` | no toca |
| M | Inv/Date | `INVOICE No.` | solo si tiene valor | solo si tiene valor (nunca borra lo que escribió contabilidad) |
| N | Quote / PO / Deposit | `Quote #` y `P.O. No.` unidos (`Q 1234 / PO 5678`) | solo si tiene valor | solo si tiene valor |
| O | Notes | — | vacío | no toca |
| P | LINK | link del PDF en Drive | cuando el PDF llega a Drive | se mantiene |

Columnas Q en adelante: las escribe la spec de producción, no esta.

## 5. Flujo al guardar (crear)

1. **Validación en el servidor:** `FOR` obligatorio y `DATE` válida.
2. **Reserva del Work Order #:**
   - Siguiente = máx(WO en el espejo D1, WO en las primeras 50 filas de la hoja leídas en ese momento) + 1.
   - Se inserta en `virtual_dockets` con estado `saving`; la clave primaria impide duplicados.
   - Si choca, se intenta con el siguiente número (máx. 5 intentos).
3. **Escritura en la hoja:** `insertDimension` en la fila 2 y luego `values.update` de `A2:P2`, en una sola llamada `batchUpdate`.
4. **Confirmación:** `virtual_dockets.state = 'saved'` y upsert inmediato en el espejo `dockets`, así aparece al instante sin esperar la sincronización.
5. **PDF (en el navegador):**
   - Se genera con `@react-pdf/renderer` (carga diferida, solo en la pantalla del docket) y se envía a `PUT /api/dockets/:wo/pdf`.
   - El Worker lo guarda en **R2** (`dockets/<wo>.pdf`) y, en segundo plano, lo sube a Drive y escribe el link en P.
   - Si Drive falla, queda `drive_status = 'pending'` y la pasada de 5 minutos reintenta.
6. **Si falla el paso 3**, se borra la reserva y el usuario ve `Could not save to Google Sheet. Nothing was saved. Try again.`. Nunca queda un lado sin el otro.

**Editar:**
- Se busca la fila por Work Order, leyendo la columna C. Se actualizan solo las columnas marcadas "escribe" y se regenera el PDF, que reemplaza el de R2 y el de Drive (Drive guarda versiones).
- `version` se incrementa. Si dos personas editan a la vez, la segunda recibe `This docket was changed by <name>. Reload to see the latest version.`

**Dockets que nacieron en la hoja:** `Open Docket` muestra el formulario prellenado con las columnas de la hoja. Al guardar se crea su `virtual_docket` y su PDF, sin insertar fila: se actualiza la existente.

## 6. Cancelar, borrar y restaurar

- **`Cancel docket`** (Admin y Manager):
  - Escribe en M `CANCEL D-MMM-YY` (formato que ya usan, ej. `CANCEL 5-NOV-26`). El docket pasa a History → Cancelled.
  - Pide confirmación. No borra nada.
- **`Delete`** (solo Admin):
  - Pide confirmación escribiendo el Work Order.
  - Borra la fila de la hoja (`deleteDimension`, buscando el WO en la columna C) y guarda en `virtual_dockets.deleted_row_json` la copia de A–P.
  - Marca `deleted_at` y lo mueve a **`Trash`**.
- **`Trash`** (Admin):
  - Lista los borrados con días restantes y `Restore`.
  - Restaurar reinserta la fila **arriba** de la hoja con sus valores originales.
  - La pasada nocturna purga los de más de 30 días: R2, Drive (a la papelera de Drive) y D1.

## 7. Datos (D1, migración 0003)

- **`virtual_dockets`:**
  - `work_order` (PK), `state` (`saving` | `saved`), `form_json` (todo el formulario), `version`.
  - PDF: `pdf_key`, `drive_file_id`, `drive_link`, `drive_status` (`none` | `pending` | `done` | `failed`).
  - Auditoría: `created_by`, `created_at`, `updated_by`, `updated_at`, `deleted_at`, `deleted_by`, `deleted_row_json`.
- **`docket_jobs`:** `id`, `work_order`, `name`, `sort`.
- **`job_steps`:** `job_id`, `step`, `role_id`, `assignee_ids` (JSON). Las consume la spec de producción.
- **`google_connection`** (fila única): `email`, `refresh_token_enc`, `sheet_id`, `drive_folder_id`, `connected_at`, `connected_by`.
- **R2:** bucket `contempra-dockets`, gratis hasta 10 GB (un docket ≈ 60 KB → ~150.000 dockets).

## 8. Pantallas

- **`New Docket`:** botón principal en Main Dashboard (Admin y Manager), y en el iPad como pantalla de inicio del front desk. Barra superior con `Save`, `Save & New`, `Cancel` y el estado del borrador (`Draft saved`).
- **Tarjeta de detalle** (modal actual), con acciones nuevas:
  - `Open Docket` (formulario; solo lectura para Staff).
  - `Download PDF`, `Open in Drive`, `Edit`, `Cancel docket` y `Delete`, según el permiso.
- **`Trash`** en Admin.
- **Admin → `Google Connection`.**

## 9. Permisos

| Acción | Admin | Manager | Staff |
|---|---|---|---|
| Crear / editar docket | ✓ | ✓ | — |
| Ver docket y PDF | ✓ | ✓ | ✓ sin precios |
| Ver precios | ✓ | ✓ | — |
| Cancelar | ✓ | ✓ | — |
| Borrar / restaurar / Trash | ✓ | — | — |
| Conectar Google | ✓ | — | — |

## 10. Plan gratis (presupuesto)

- **Por docket guardado:**
  - ~4 llamadas a Google: leer las 50 filas de arriba, `batchUpdate`, subida a Drive y escritura del link.
  - Un `PUT` a R2 y pocas escrituras en D1.
- **CPU del Worker:** baja. El PDF se genera en el navegador, y la subida a Drive solo reenvía bytes.
- **La sincronización de 5 minutos** sigue igual, ahora con el token OAuth.

## 11. Errores y casos límite

- **Se cae Internet a mitad del formulario:** el borrador queda en el dispositivo y al volver aparece `Restore draft?`.
- **Alguien insertó filas arriba mientras se guardaba:** no afecta, porque siempre se busca por Work Order y nunca por número de fila.
- **El WO a editar ya no está en la hoja** (alguien lo borró a mano): error `This work order is no longer in the Google Sheet` con la opción `Re-create row`.
- **Google desconectado o token revocado:** guardar muestra `Google is disconnected. Ask an admin to reconnect.` y no guarda nada. El banner del dashboard lo avisa.
- **PDF no generado** (navegador viejo): el docket se guarda igual, con `PDF pending`, y se regenera al abrirlo.

## 12. Pruebas

- **Unitarias:**
  - Mapeo formulario → A–P, incluidas las reglas de M y N en edición.
  - Resumen del cuerpo a H.
  - Totales con GST/PST.
  - Ocultar precios para Staff.
  - Formato `CANCEL D-MMM-YY`.
- **Worker:**
  - Reserva de WO concurrente (dos `POST` simultáneos → números distintos).
  - Fallo de la hoja → no queda nada guardado.
  - Editar, cancelar, borrar, restaurar y purga.
  - Reintento de Drive.
  - Cifrado del token.
- **Web:**
  - Formulario en iPad (1024 × 1366 y 1366 × 1024) sin desborde.
  - Guardar.
  - Borrador local.
  - Staff sin precios.
- **Manual:** imprimir el PDF y compararlo lado a lado con el papel.
