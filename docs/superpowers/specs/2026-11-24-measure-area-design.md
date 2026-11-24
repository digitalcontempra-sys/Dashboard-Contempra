# Área "Measure" (tomar medidas): diseño

Estado: aprobado (2026-11-24), con Measure como última área.

## Qué es

Una nueva área de producción para cuando alguien va al sitio a tomar medidas antes del diseño o de un trabajo. Funciona igual que Install: tarjeta de mano en mano, con fotos a la carpeta de Drive del docket.

## Área

- Rol `measure`, etiqueta **Measure** (rol y área). Va **última** en el orden (después de Install): `roles.sort = 10` (General sigue en 99).
- Color propio en la leyenda y en los chips (token `--area-measure` + `--area-measure-ink`, contraste AA en los dos temas).
- Aparece en: Send to / Continue (selector de personas), Production Board (columna "Measure", antes de General), filtro de áreas, My Cards y Admin → roles.

## Campos de la tarjeta (en este orden)

| Campo | Tipo | Obligatorio |
|---|---|---|
| Site checked | casilla | no |
| Measured | casilla | **sí** (★): sin ella no hay Continue ni Done → `Mark "Measured" to continue` |
| Measurements | texto libre | no |
| Address | texto | no |
| Date | calendario | no |
| Crew | texto | no |
| Photos | fotos (cámara) | no |
| Notes | texto | no |

## Hoja de Google

- Nueva columna **Measure** después de Install. Layout `v6`:
  `Stage | Design | Print Roll | Print FB | Laminate | Contour Cut | Liquid Lam | Colex | Finishing | Install | Measure | Assigned | Photos` (lógicas Q–AC; con STATUS, físicas R–AD).
- Las columnas Q–AC se reescriben desde las tarjetas (no se pierde nada: son solo del dashboard).
- **Después de publicar, el dueño pulsa Admin → Set up production columns** una vez. Hasta entonces las escrituras a la hoja quedan en cola.

## Personas

- La migración da el área Measure a: Jeff Whitaker, Kharash Ibrahim, Gary, Dennis, Larry, Nick (por usuario: `jeff.w`, `kharash`, `gary`, `dennis`, `larry`, `nick`; si alguno no existe, se ignora).
- **Cory** no tiene cuenta: el dueño la crea en Admin → Users y le asigna Measure.

## Fuera de alcance

- Lista de materiales o campos con medidas estructuradas (ancho × alto): es texto libre.
