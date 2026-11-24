# Read Docket y Edit Docket (2026-11-24)

## Objetivo

1. **Read Docket** en cada card de producción (CardView): un botón que abre el docket en solo lectura, como lista simple agrupada, más un botón **View PDF**. La card no se llena de información: todo va en ese panel.
2. En el detalle del docket (Main Dashboard), **Open Docket** pasa a llamarse **Edit Docket**, con ícono de lápiz.

## Decisiones

- **Contenido = lo que el docket ya tiene** (respuesta del dueño). No se agregan líneas nuevas al formulario. El panel muestra, omitiendo lo vacío:
  - **Customer:** Customer (FOR), Contact, Phone, Email.
  - **Dates:** Date, Required (fecha o RUSH/ASAP/NOW), Proof required.
  - **Work:** Description (texto libre, respetando saltos de línea), Materials (solo nombres), Labour (nombre, trabajo, horas, fecha).
  - **Address & service:** Address, Service (INSTALLATION/DELIVERY/SERVICE/PICKUP), Call when ready.
  - **Order:** Quote #, PO #, Order taken by, Account Manager (salesperson).
  - **Notes** y **Link** (columnas O y P de la hoja). El link es clicable y solo lo ven Admin/Manager.
- **Notes para todos, Link sin Staff:** la columna P guarda el link de Drive del PDF con precios, así que el servidor manda `link: null` a Staff. `GET /api/virtual-dockets/:wo` agrega `sheet: { notes, link }` leído del espejo `dockets`. Staff no puede usar `/api/dockets/:wo`, por eso va en este DTO.
- **Precios:** el servidor ya quita precios a Staff (`stripPrices`). El panel nunca muestra costos, totales, impuestos ni depósito, para nadie (es una vista de producción).
- **View PDF:** Admin/Manager con PDF guardado abren el PDF guardado (con precios). Staff (o sin PDF guardado) ven una copia generada en el navegador; Staff sin precios. La pestaña se abre antes de generar (si no, Safari en iPhone la bloquea). Si el navegador la bloquea igual, se muestra un mensaje y la card sigue abierta.
- **UI:** el botón `Read Docket` va en el encabezado de la card (no ocupa espacio en el cuerpo). El panel es un diálogo encima de la card (z mayor), con `Close`; Escape cierra solo el panel. Sin scroll lateral a 375 px.
- **Edit Docket:** mismo enlace `/dockets/:wo`, texto `Edit Docket` con ícono `pencil`.
