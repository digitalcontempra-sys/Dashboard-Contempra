# My Dockets: diseño

Fecha: 2026-11-26. Rama `feature/my-dockets`.

## Objetivo

Que cada vendedor vea en el Main Dashboard solo sus dockets. El dueño de un docket es la columna J del Sheet (Account Manager), que en el editor es el campo **SALESPERSON**. En el Sheet la gente sigue escribiendo sus códigos a mano en J.

## 1. Códigos por usuario

- Tabla nueva `user_codes (code TEXT PRIMARY KEY, user_id → users, sort)` (migración `0013_user_codes.sql`).
  - El código se guarda en mayúsculas y sin espacios. La clave primaria garantiza que cada código pertenece a un solo usuario.
  - `sort` = orden; el primero (`sort = 0`) es el **principal**.
- Carga inicial en la migración, buscando por `username` (sin distinguir mayúsculas; verificado en producción el 2026-11-26):
  `ali` AR, ALI · `Cory` CB · `danni` DA, DB · `diane` DL · `ira` IS · `jeff.b` JB · `justin` JG · `kristy` KD · `meinrad` MB.
  - Si un usuario no existe (p. ej. en la BD local o de tests) no se inserta nada.
  - `CF` y `MN` (aparecen en J) no son de nadie: solo salen en All dockets.
- **Admin → Users → Edit / Add user:** campo **Initials** (texto, separados por coma o espacio; el primero es el principal). La lista muestra los códigos de cada usuario.
  - API: `codes: string[]` en `POST /api/users` y `PATCH /api/users/:id`; `UserDTO.codes`.
  - Validación: cada código 1–10 caracteres `A-Z0-9` (tras mayúsculas y quitar espacios), sin repetidos. Si otro usuario ya lo tiene: 409 `Initials XX already belong to <name>.`
- `GET /api/auth/me` devuelve `codes` (para el editor y el dashboard).

## 2. Salesperson en el editor

- **Docket nuevo:** SALESPERSON = código principal de quien lo crea, de solo lectura. El servidor lo impone (ignora lo que mande el navegador).
  - Sin códigos: el servidor responde 400 `Ask an admin to set your initials first.` y el editor muestra el mismo mensaje y desactiva Save, Save & New y Save as New Order.
- **Editar un docket existente:** SALESPERSON no cambia. Siempre de solo lectura; el servidor conserva el valor anterior (el del último guardado, o el del Sheet para dockets nacidos en el Sheet), así que J nunca se reescribe al editar.
- Se quita la lista de sugerencias (datalist) de SALESPERSON.

## 3. Main Dashboard: All dockets | My Dockets

- Selector `All dockets | My Dockets` arriba de las vistas (Active / On Hold / History).
- My Dockets = dockets cuya J (ya normalizada: trim + mayúsculas en el sync) es cualquiera de mis códigos. Funciona en Active, On Hold y History.
  - API: `GET /api/dockets?mine=1`; el servidor usa los códigos del usuario de la sesión. Mismas secciones, órdenes y contadores.
  - El filtro Account Manager y la búsqueda siguen funcionando encima.
- La elección se recuerda por usuario en `localStorage` (`dashboard.scope.<userId>`), envuelto en try/catch.
- Sin códigos, My Dockets muestra `Ask an admin to set your initials.` (sin pedir la lista).

## Decisiones

- Los códigos se leen en `/auth/me` y en el servidor al crear/listar, no en cada petición (no se añade a `loadUser`).
- Non-Billed no cambia.
