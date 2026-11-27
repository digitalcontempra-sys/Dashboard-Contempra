# D1 rows read: índices, sync por bloques y polling con 304

**Fecha:** 2026-11-27 · **Rama:** `feature/d1-rows-read` · **Migración:** `0015_rows_read.sql`

## Problema

D1 free permite 5M rows_read/día y ya íbamos al 77 % solo con pruebas. `wrangler d1 insights` mostraba que las rutas calientes leían casi toda la tabla `dockets` (11.6k filas, solo 533 `active`):

| Consulta | Antes (por llamada) | Frecuencia |
|---|---|---|
| Sync: `work_order IN (SELECT value FROM json_each(?))` | ~3.6k | cada 5 min |
| Summary At risk (`account_manager IN …`) | ~5.2k | cada 30 s |
| Lista del dashboard (`WITH base …`, 3 sentencias) | ~2.7k (My Dockets 17.7k) | cada 30 s |
| `GROUP BY account_manager` | ~11.6k | al abrir el dashboard |

Objetivo: un dashboard abierto 8 h < ~200k filas/día; el cron < ~100k filas/día.

## Qué cuenta D1 (medido en tests con `meta.rows_read`)

- Cada entrada de índice y cada fila de tabla visitada cuentan. Leer filas completas por un índice no covering cuesta 2 por fila; un índice covering, 1.
- Las filas de tablas temporales (sorter de `ORDER BY`, `GROUP BY`, CTE `MATERIALIZED`) también cuentan.
- Las sondas `EXISTS (…)` / subconsultas correlacionadas que no encuentran nada no suman.
- Sin `sqlite_stat1` el planner elige mal (`idx_dockets_am` recorría todos los dockets del AM, también los completados; un `JOIN` recorría los dockets activos en vez de los pocos `virtual_dockets`).

## Decisiones

1. **Índices covering** (migración 0015):
   - `idx_dockets_status_cover (status, due_iso, due_rush, date_iso, work_order)`: conteos por sección leen 1 entrada por docket.
   - `idx_dockets_status_date (status, date_iso, CAST(work_order AS INTEGER), work_order, due_iso, due_rush)`: la página "newest first" sale del índice en orden, sin ordenar.
   - `idx_dockets_am_cover (account_manager, status, date_iso, CAST(work_order AS INTEGER), work_order, due_iso, due_rush)`: My Dockets, At risk y el filtro de AM; reemplaza `idx_dockets_am`.
   - `idx_dockets_wo_num (CAST(work_order AS INTEGER))`: History plano (sin filtros, ni Completed/Cancelled, ni sección) recorre el índice desde el WO más nuevo y para tras una página (`INDEXED BY`).
   - `idx_cards_status_role (status, role_id)`.
   - Se borran `idx_dockets_status_due` e `idx_dockets_am` (los cubren los nuevos).
2. **Lista del dashboard:** 2 sentencias en vez de 3 (el total sale de los conteos); conteos con `sum(section = …)` en vez de `GROUP BY`; la CTE solo lleva columnas del índice; filas completas y subconsultas por tile solo para las 50 de la página (`pg CROSS JOIN dockets`). `NEWEST_FIRST` = `date_iso DESC, CAST(work_order AS INTEGER) DESC` (SQLite ordena NULL como el menor, igual que antes con `date_iso IS NULL`).
3. **Summary:** "Waiting (a)" usa `EXISTS` sobre `dockets` en vez de `JOIN` (el planner recorría los activos).
4. **Account managers:** caché en `app_settings.account_managers` por 24 h. Un sync (incremental, completo o el espejo al guardar un docket) que escribe un código que la caché no conoce la borra. Los conteos de códigos conocidos pueden atrasarse hasta un día (solo ordenan el selector).
5. **Sync incremental por bloques:** tabla `sync_blocks (block, hash)`; bloque = `floor(WO / 50)` (no por fila: un docket nuevo arriba desplaza todas las filas). Si el hash del bloque (WO + row_hash + duplicado) no cambió, no se leen sus dockets. Solo se buscan (por PK, `json_each CROSS JOIN dockets`) los dockets de bloques cambiados. El hash del bloque se guarda después de escribir sus dockets. Un trigger borra `sync_blocks` al borrar cualquier docket (Trash, nightly, a mano), y otros (migración 0016) olvidan el bloque de un docket insertado o actualizado fuera del sync incremental (sync completo, guardar en el dashboard): si la hoja vuelve al valor anterior, el bloque ya no coincide por error. Un bloque cortado por el borde del top o de una página se relee: unos pocos bloques por run.
6. **Polling con 304:** tabla `data_version` (una fila) que suben triggers en `dockets`, `virtual_dockets`, `cards`, `task_cards`, `docket_follows`, `users`, `user_codes`, `user_roles`, `card_seen`. En `cards` el `UPDATE` solo sube si cambia algo que se ve (estado, personas, etapa…, o `vendorPickup` / `packaged`); guardar otros campos no. `GET /api/dockets`, `/api/dashboard/summary` y `/api/my-cards/summary` responden con `ETag` débil (versión + deploy + usuario + URL + fecha de Winnipeg; el summary y `focus` añaden un tramo de 5 min) y `Cache-Control: private, no-cache`. El navegador revalida solo; sin cambios = 304 con 1 fila leída. Deploy id: binding `version_metadata` (`CF_VERSION_METADATA`, free).
7. **Pestaña oculta:** TanStack ya no repite `refetchInterval` con la pestaña oculta (por defecto) y refresca al volver. Las alertas (`/api/my-cards/summary`) siguen en segundo plano porque el título y el chime avisan ahí, pero cada 60 s en vez de 20 s. History refresca cada 5 min (su conteo lee ~11k entradas).

## Cifras (tests con 11.6k dockets sembrados como producción)

| Ruta | Antes | Después |
|---|---|---|
| Lista All | 2.7k | ~730 |
| My Dockets | 17.7k | ~470 |
| Summary | 6.8k | ~270 |
| Account managers | 11.6k | 1 (caché) |
| History | 44k | ~11.9k (cada 5 min) |
| Sync sin cambios | ~3.6k | ~15 |
| Poll sin cambios | lo anterior | ~1 + sesión |

## Pendiente / límites

- History sigue contando todos los cerrados (~11k) cada vez que cambia algo y está abierto.
- Un cambio de datos cualquiera invalida el ETag de todos; con mucha actividad cada poll recalcula (~1k filas).
