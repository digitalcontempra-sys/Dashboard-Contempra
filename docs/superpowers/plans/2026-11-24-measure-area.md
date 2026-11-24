# Measure area Implementation Plan

**Goal:** Add a "Measure" production area (site measurements), last in the order, with its own sheet column.

**Spec:** `docs/superpowers/specs/2026-11-24-measure-area-design.md`

## Tasks

1. **Role + fields** (`src/shared/cards.ts`, `migrations/0010_measure.sql`, `src/shared/staffRoster.ts`)
   - `measure` last in `ROLE_ORDER`; `ROLE_LABEL`/`AREA_LABEL` "Measure"; `AREA_TOKEN` `area-measure`.
   - `CARD_FIELDS.measure`: Site checked, Measured (required), Measurements, Address, Date, Crew, Photos, Notes.
   - Migration: role sort 10; `measure` for `jeff.w`, `kharash`, `gary`, `dennis`, `larry`, `nick` (`INSERT OR IGNORE`).
   - Tests: `test/shared/cards.test.ts`, `test/worker/schema.test.ts`, roles route, staff import.
2. **Colors** (`src/web/index.css`): `--area-measure` / `--area-measure-ink`, light and dark. Tests: legend (10 areas), AA contrast.
3. **Sheet v6** (`src/worker/cards/sheetSync.ts`): "Measure" after "Install" in `STAGE_HEADERS`; `AREA_COLS` gains AA; Assigned → AB, Photos → AC; set up reads/clears Q–AC; `PRODUCTION_COLUMNS_VERSION = "v6"`. Tests: `cardSheet` (Measure column, v5 → v6 upgrade, Photos in AC), `statusColumn`.
4. **Photos**: Drive file name uses the card's area label instead of "Install".
5. **Docs**: CLAUDE.md (roles, Q–AC table, migrations, test count).
