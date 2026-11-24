# Plan: Dashboard sections (New Orders, Daily Complete, Upcoming)

Spec: `docs/superpowers/specs/2026-11-24-dashboard-sections-design.md`. TDD for each task; whole suite + typecheck at the end.

1. **Shared buckets.** `TimeBucket = rush_today | upcoming | no_due_date`; `deriveTimeBucket` drops the week split. Add `DashSection` and `DASH_SECTIONS` in `src/shared/rules.ts`. Update `taskCards`, routes (`cards.ts`, `dockets.ts`) and tests.
2. **Migration 0012.** `virtual_dockets.new_order INTEGER NOT NULL DEFAULT 0`.
3. **List query.** `src/worker/db/dockets.ts`: a `section` CASE (new order → daily complete → time), counts per section, per-section order, All by creation date. `DocketSummary.section`, `readySince`. Tests in `test/worker/dockets.test.ts`.
4. **New Order save.** `createDocket` / `updateDocket` accept `newOrder`; validation (body required, no handoff, no cards); set flag + queue sheet; hand-off clears flag. DTO `newOrder`. Tests in worker virtual docket tests.
5. **Sheet.** `stageRowCells(..., newOrder)` → K = creator, STATUS `Waiting for more info` when no cards. `flushCardSheet` passes it.
6. **Web.** `format.ts` (BUCKETS 3, SECTIONS 6 incl. tones), tokens `--new-order`, `BucketFilter` takes options, `BucketTag` takes a section, Dashboard uses sections, tile click on New Order → editor, Daily Complete `Ready since`. Editor: `Save as New Order` button + subtitle.
7. **Docs.** CLAUDE.md §2, §5, §12 (status refresh), test count.
8. **Verify.** vitest, typecheck, local preview at 375 px, fresh reviewer, fixes.
