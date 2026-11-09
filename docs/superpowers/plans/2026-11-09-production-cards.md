# Production Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each docket's production route becomes a chain of cards, one per step. Each card has role-specific fields and `Continue →` / `← Send back` controls. Arriving cards trigger hard-to-miss notifications. Managers get a flow history and a Production Board, and the Google Sheet shows each docket's stage in columns Q–Z plus a `Production` tab.

**Architecture:** D1 is the source of truth for cards (`cards`, `card_events`, `card_seen`). Every card action commits to D1 first, then queues the docket in `card_sheet_queue`. A flush writes the sheet in the background (`waitUntil`) under the existing `sheet` lock, and the 5-minute cron retries failed flushes, so Google outages never block production. The pure card rules (required fields, Continue blockers, ordering within a job, sheet cell text) live in `src/shared`, where the web and worker both use them. The web polls `/api/my-cards/summary` every 20 s for notifications.

**Tech Stack:** Existing stack: Workers + Hono + D1 + React 19 / TanStack Query / Tailwind v4 + Vitest 4 (`@cloudflare/vitest-plugin` for worker, jsdom for web). Web Audio API for the chime (no audio files). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-09-production-cards-design.md` (base: `2026-10-19-dashboard-contempra-design.md`, `2026-11-05-virtual-docket-design.md`).

## Global Constraints

- All user-facing text is English, using the spec's strings exactly (`Continue → Laminate`, `Continue → Done`, `Send to production →`, `← Send back`, `I'm on it`, `Returned by <name> · <reason>`, `Seb is working on it`, `This card was already moved by <name>.`, `(2) New cards · Contempra`, `NEW`, `Sound on/off`, `Vendor pickup ready`, `Set up production columns`, `History`, `Production Board`).
- Free Cloudflare plan only. Polling every 20 s with a single light query per user. No Durable Objects, no WebSockets, no push.
- Google writes always go through `withLock(db, SHEET_LOCK)`. Sheet rows are always located by Work Order (column C).
- The dashboard writes Q–Z only after `Set up production columns` has run (`app_settings.production_columns = 'ready'`). Before that, sheet flushes stay queued.
- Required-field (★) rules are enforced on the server. The UI uses the same `continueBlocker` function.
- Staff never receive prices (the existing rule still applies to any docket data the card endpoints return).
- Touch targets ≥ 44px. Cards work on iPad portrait/landscape and phone width with no horizontal scroll.
- Role ids after migration: `designer`, `printer_roll`, `printer_fb`, `laminate_roll`, `liquid_lam`, `colex`, `finishing`, `installer` (sorts 1–8).
- Area names (used in `Continue → <area>` and sheet `Stage`) come from `AREA_LABEL` (Task 2): `Design`, `Print Roll`, `Print FB`, `Laminate`, `Liquid Lam`, `Colex`, `Finishing`, `Install`.

## Review Focus

1. **The route is edited while cards are in progress.** Steps that are done or in progress keep their fields and state. Removed steps disappear from My Cards. A step added before the active one becomes active (test in Task 3).
2. **A docket is cancelled or moved to Trash with active cards.** Its cards vanish from My Cards and the Board, and come back on restore (test in Task 5).
3. **Google is down or disconnected when someone presses Continue.** The card still moves and the next team is notified. The sheet catches up on the next cron (test in Task 6).
4. **A user has two roles, or a docket has two jobs active for the same team.** Every active card shows once per card, not once per role (test in Task 5).
5. **A team step's role has no active members.** The Board marks it `No one has this role`. Managers can still act on it (tests in Tasks 5 and 9).

---

## File Structure

```
migrations/0004_production_cards.sql        roles change, cards, card_events, card_seen, card_sheet_queue, app_settings, users.sound_on
src/shared/cards.ts                          pure: field specs per role, continueBlocker, normalizeJob, AREA_LABEL, nextAreaLabel, fieldsSummary, stage/area cell text
src/shared/types.ts                          + CardDTO, CardEventDTO, MyCardsSummary, BoardDTO
src/worker/cards/service.ts                  reconcileCards, listMyCards, getCard, claim, saveFields, continueCard, sendBack, history, board, markSeen
src/worker/cards/sheetSync.ts                queueCardSheet, flushCardSheet, retryCardSheet, setupProductionColumns
src/worker/google/sheets.ts                  + ensureTab, writeRange, appendRows, clearColumns
src/worker/routes/cards.ts                   card + board + history + sound + setup routes
src/worker/dockets/service.ts                calls reconcileCards in create/update; exports locateRow
src/worker/index.ts                          mount routes; cron calls retryCardSheet
src/web/cards/CardView.tsx                   full card: header, role fields, Continue / Send back / I'm on it
src/web/cards/CardTile.tsx                   square tile with NEW glow, returned strip, claimed-by line
src/web/cards/fields.tsx                     per-role field editors
src/web/cards/useCardAlerts.ts               20 s poll, chime, badge count, tab title
src/web/cards/chime.ts                       Web Audio bell
src/web/pages/MyCards.tsx                    replaced: grouped tiles, role tabs
src/web/pages/ProductionBoard.tsx            columns per area, filters
src/web/components/DocketHistory.tsx         timeline for History tab
src/web/components/DocketDetail.tsx          tabs Details / Production / History
src/web/components/Layout.tsx                badge on My Cards, Production Board nav, Sound toggle
src/web/docket/ProductionPanel.tsx           "· Team" / "· <name>" chip label
src/web/pages/AdminUsers.tsx                 Set up production columns button
```

---

### Task 1: Migration 0004 (roles, card tables, settings)

**Files:**
- Create: `migrations/0004_production_cards.sql`
- Modify: `test/worker/schema.test.ts`

**Interfaces:**
- Produces tables:
  - `cards(id INTEGER PK, work_order TEXT NOT NULL REFERENCES virtual_dockets(work_order) ON DELETE CASCADE, job_sort INTEGER NOT NULL, job_name TEXT NOT NULL, step INTEGER NOT NULL, role_id TEXT NOT NULL REFERENCES roles(id), assignee_ids TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL CHECK (status IN ('waiting','active','done')), claimed_by INTEGER REFERENCES users(id), fields_json TEXT NOT NULL DEFAULT '{}', returned_reason TEXT, returned_by INTEGER REFERENCES users(id), version INTEGER NOT NULL DEFAULT 0, activated_at TEXT, done_at TEXT, done_by INTEGER REFERENCES users(id), updated_at TEXT NOT NULL, UNIQUE (work_order, job_sort, step))` with indexes `(role_id, status)` and `(work_order)`.
    - **Deviation from spec §9:** the spec names `job_id`, but `jobStatements` deletes and re-inserts `docket_jobs` on every save, so job ids change. Cards are therefore keyed by `job_sort` and keep `job_name` as text.
  - `card_events(id INTEGER PK, card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE, work_order TEXT NOT NULL, action TEXT NOT NULL CHECK (action IN ('activated','claimed','field','continued','sent_back','completed','removed')), detail_json TEXT NOT NULL DEFAULT '{}', user_id INTEGER REFERENCES users(id), at TEXT NOT NULL)` with index `(work_order, at)`.
  - `card_seen(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE, seen_at TEXT NOT NULL, PRIMARY KEY (user_id, card_id))`.
  - `card_sheet_queue(work_order TEXT PRIMARY KEY, hold INTEGER, comp INTEGER, queued_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT)`. `hold` and `comp` are NULL (no change) or 0/1.
  - `app_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)`.
  - `users.sound_on INTEGER NOT NULL DEFAULT 1`.
- Role changes, in this order: insert `('colex','Colex',6)`; repoint `user_roles` and `job_steps` from `colex_finish` to `colex`; delete `colex_finish`; insert `('installer','Installer',8)`. `finishing` keeps sort 7.

- [ ] **Step 1: Update `test/worker/schema.test.ts`.**
  - The expected role list becomes `designer, printer_roll, printer_fb, laminate_roll, liquid_lam, colex, finishing, installer`, ordered by sort.
  - Add a test: insert a user with the role `colex`, then a `cards` row, a `card_events` row and a `card_seen` row. Deleting the `virtual_dockets` row cascades all three away.
- [ ] **Step 2:** Run `npx vitest run test/worker/schema.test.ts`. Expected: FAIL (`colex` missing).
- [ ] **Step 3:** Write the migration. Use `ALTER TABLE users ADD COLUMN sound_on ...`.
- [ ] **Step 4:** Run `npx vitest run`. Expected: all PASS.
  - Fix any test that still references `colex_finish`: grep `test/` and `src/`.
- [ ] **Step 5:** Commit `feat: production cards schema; Installer role; Colex renamed`.

### Task 2: Card rules (pure, shared)

**Files:**
- Create: `src/shared/cards.ts`
- Modify: `src/shared/types.ts`
- Test: `test/shared/cards.test.ts`

**Interfaces:**
- Produces (`src/shared/cards.ts`):
  - `type CardStatus = "waiting" | "active" | "done"`.
  - `type CardFields = Record<string, string | boolean | null>`.
  - `const AREA_LABEL: Record<string, string>`, mapping role id to area name as in Global Constraints.
  - `const CARD_FIELDS: Record<string, { key: string; label: string; kind: "check" | "text" | "choice" | "catalog"; options?: string[]; required?: boolean }[]>`. Keys and labels are exactly:
    - `designer`: `sentProof` "Sent proof" (check); `proofApproved` "Proof approved" (check, required only when proofRequired); `onHold` "On hold" (check); `note` "Note" (text); `file` "File" (text).
    - `printer_roll`: `printed` "Printed" (check, req); `machine` "Machine" (catalog); `material` "Material used" (catalog); `lengthFt` "Material length (LN FT)" (text); `note` "Note" (text); `file` "File" (choice `ok`/`missing`, req).
    - `printer_fb`: `printed` "Printed" (check, req); `material` "Material" (catalog); `sheetKind` (choice `new`/`cutoff`, labels "New sheet"/"Cut off", req); `sheetSize` "Size" (text, req); `sheetQty` "Qty" (text, req); `sheetsUsed` "# Sheets used" (text); `note` "Notes" (text); `file` "File" (choice, req).
    - `laminate_roll`: `laminated` "Laminated" (check, req); `material` "Material" (catalog); `lengthFt` "Material length (LN FT)" (text); `note` "Notes".
    - `liquid_lam`: `laminated` "Laminated" (check, req); `coating` "Coating" (text); `note` "Notes".
    - `colex`: `completed` "Completed" (check, req); `cutFileMissing` "Cut file missing" (check); `note` "Notes".
    - `finishing`: `grommets` "Grommets", `tape` "Tape", `tapeKind` "Kind" (text), `trimmed` "Trimmed", `mounted` "Mounted", `vendorPickup` "Ready for vendor pickup" (checks); `packaged` "Packaged" (choice `almost`/`ready`/`shipped`, labels "Almost Ready"/"Ready"/"Shipped", req); `leftAt` "I left this job at…" (text, req).
    - `installer`: `siteChecked` "Site checked" (check); `installed` "Installed" (check, req); `address` "Address", `date` "Date", `crew` "Crew", `photos` "Photos", `note` "Notes" (text).
  - `sanitizeFields(roleId: string, input: unknown): CardFields`. Keeps only the keys in `CARD_FIELDS[roleId]`. Checks become booleans. Text is trimmed and capped at 500 characters. A choice value outside its options becomes `null`.
  - `continueBlocker(roleId: string, f: CardFields, ctx: { proofRequired: boolean }): { message: string; sendBackToDesign: boolean } | null`. Checks run in this order; the first failure is returned:
    1. `file === "missing"` → `File is missing. Send it back to Design.` (sendBackToDesign true).
    2. colex `cutFileMissing` → `Cut file is missing. Send it back to Design.` (sendBackToDesign true).
    3. Required checks unset → `Mark "<label>" to continue`.
    4. Required choice unset: file → `Choose File: OK or Missing`; sheetKind → `Choose "New sheet" or "Cut off"`; packaged not `ready`/`shipped` → `Set Packaged to "Ready" or "Shipped" to continue`.
    5. Required text empty: sheetSize/sheetQty → `Enter the size and quantity`; leftAt → `Fill in "I left this job at…" to continue`.
    - Designer `proofApproved` is required only when `ctx.proofRequired`.
  - `continueLabel(roleId: string, nextRoleId: string | null): string`. Designer → `Send to production →`. Otherwise `Continue → ${AREA_LABEL[next]}`, or `Continue → Done` when next is null.
  - `normalizeJob<T extends { step: number; status: CardStatus }>(cards: T[]): T[]`. Sorted by step: the done prefix stays done, the first non-done becomes `active`, and the rest become `waiting`. Returns new objects only for changed cards (identity kept otherwise).
  - `fieldsSummary(roleId: string, f: CardFields): string`. Set fields in `CARD_FIELDS` order, joined with ` · `. A check shows as `Label ✓`; a choice or text as `Label: value` (choice uses its option label). Example: `Printed ✓ · Machine: HP Latex 800 · Material used: IJ35 · Material length (LN FT): 24`.
  - `areaCellText(c: { status: CardStatus; returnedReason: string | null; claimedByName: string | null; doneByName: string | null; doneAt: string | null; fields: CardFields; roleId: string } | null): string`. `null` → `—`. Otherwise:
    - `waiting` → `Pending`.
    - `active` with a returned reason → `Returned · <reason>`.
    - `active` → `Active · <claimer first name>` or `Active · Team`.
    - `done` → `✓ <first name> MM/DD` (Winnipeg date).
    - Finishing `done` appends ` · Ready` or ` · Shipped` from `packaged`.
  - `stageText(active: { roleId: string }[], allDone: boolean): string`. Unique area labels in role sort order joined by `, `, or `Done` when allDone, or `—` when there are no cards.
- Produces (`src/shared/types.ts`):
  - `CardDTO = { id: number; workOrder: string; jobName: string; step: number; roleId: string; status: CardStatus; assigneeIds: number[]; team: boolean; claimedBy: { id: number; name: string } | null; fields: CardFields; returned: { reason: string; by: string } | null; version: number; activatedAt: string | null; isNew: boolean; nextRoleId: string | null; earlier: { step: number; roleId: string }[]; header: { customer: string | null; accountManager: string | null; project: string | null; address: string | null; bucket: TimeBucket; dueIso: string | null; dueRaw: string | null; proofRequired: boolean } }`.
  - `CardEventDTO = { at: string; area: string; user: string | null; action: string; detail: string }`.
  - `MyCardsSummary = { newCount: number; activeCount: number; soundOn: boolean }`.
  - `BoardDTO = { columns: { roleId: string; area: string; cards: (CardDTO & { noMembers: boolean })[] }[]; productionColumnsReady: boolean }`.

- [ ] **Step 1: Write failing tests in `test/shared/cards.test.ts`.**
  - `continueBlocker("laminate_roll", {}, {proofRequired:false})?.message` → `Mark "Laminated" to continue`. With `{laminated:true}` → `null`.
  - printer_roll `{printed:true, file:"missing"}` → message `File is missing. Send it back to Design.` and sendBackToDesign `true`. `{printed:true}` → `Choose File: OK or Missing`.
  - printer_fb `{printed:true, file:"ok", sheetKind:"cutoff"}` → `Enter the size and quantity`.
  - colex `{completed:true, cutFileMissing:true}` → the cut-file message.
  - finishing `{packaged:"almost", leftAt:"Rack 3"}` → the Packaged message. `{packaged:"ready", leftAt:""}` → the leftAt message.
  - designer `{}` with proofRequired false → `null`; with true → `Mark "Proof approved" to continue`.
  - `continueLabel("printer_roll","laminate_roll")` → `Continue → Laminate`. `("finishing", null)` → `Continue → Done`. `("designer","printer_roll")` → `Send to production →`.
  - `normalizeJob` on steps [done, waiting, active] → [done, active, waiting]. On [active(0) after a send-back, waiting, waiting] → unchanged.
  - `sanitizeFields("colex", {completed:"yes", evil:1, note:"x".repeat(600)})` → `{completed:true, note: 500 chars}` with no `evil` key.
  - `fieldsSummary` matches the spec example.
  - `areaCellText` covers each state: done finishing shipped on `2026-11-09T20:00:00Z` → `✓ Seb 11/09 · Shipped`.
  - `stageText([{roleId:"colex"},{roleId:"printer_roll"}], false)` → `Print Roll, Colex`.
- [ ] **Step 2:** Run `npx vitest run test/shared/cards.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `src/shared/cards.ts` and the DTO types.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat: production card rules`.

### Task 3: Cards follow the docket route (reconcile)

**Files:**
- Create: `src/worker/cards/service.ts`
- Modify: `src/worker/dockets/service.ts` (call reconcile in `createDocket` and `updateDocket`, inside the same `db.batch` flow, after `jobStatements`)
- Test: `test/worker/cards.test.ts`

**Interfaces:**
- Consumes: `normalizeJob` (Task 2); `ProductionJob`.
- Produces:
  - `reconcileCards(db: D1Database, wo: string, jobs: ProductionJob[], actorId: number, now: string): Promise<number[]>`. Returns the ids of cards that became `active` (for notification and sheet queueing).
- Rules:
  - Match existing cards on `(job_sort, step, role_id)`. A match keeps its status, fields, claim and version; `assignee_ids` and `job_name` are updated.
  - Insert new steps as `waiting`.
  - Delete cards whose `(job_sort, step, role_id)` is gone. Their events cascade away, so log the removal as a `removed` event on the job's first remaining card, with detail `{ "removedArea": "<area>" }`. When the job has no remaining cards, log nothing.
  - Run `normalizeJob` per job.
  - Every card that becomes `active` gets `activated_at = now` and an `activated` event.
  - A job with zero steps gets no cards.
  - A docket whose route has no steps at all has no cards, so it is never auto-completed.

- [ ] **Step 1: Write failing worker tests.** Use `fakeGateways()`, `seedConnection()` and `createUser`, and create dockets through `POST /api/virtual-dockets`:
  - Route designer → printer_roll → laminate_roll gives 3 cards: active, waiting, waiting. The active card has an `activated` event.
  - Two jobs give an active first card in each job.
  - Editing the route while step 0 is done and step 1 is active, inserting `printer_fb` before step 1: the done card stays done, the new step becomes active (its fields are empty), the old step 1 becomes waiting, and its fields are kept.
  - Removing the active step makes the next one active. The removed card is gone, and the history shows `removedArea`.
  - Changing only assignees keeps status and fields.
- [ ] **Step 2:** Run `npx vitest run test/worker/cards.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `reconcileCards` and call it from `createDocket` (after the state becomes `saved`) and from `updateDocket` (after its batch).
- [ ] **Step 4:** Run `npx vitest run`. Expected: all PASS.
- [ ] **Step 5:** Commit `feat: cards follow the docket route`.

### Task 4: Card actions (claim, fields, continue, send back)

**Files:**
- Modify: `src/worker/cards/service.ts`
- Create: `src/worker/routes/cards.ts`; mount it in `src/worker/index.ts`
- Test: `test/worker/cards.test.ts`

**Interfaces:**
- Consumes: Task 2 (`sanitizeFields`, `continueBlocker`, `normalizeJob`), Task 3.
- Produces (all throw `ServiceError` from `src/worker/dockets/errors.ts`):
  - `canAct(card, user: SessionUser): boolean`. True when the user is admin or manager. Otherwise the user must have the card's role and either `assignee_ids` is empty or contains the user.
  - `claimCard(env, user, id): Promise<CardDTO>`. Sets `claimed_by`, adds a `claimed` event, and leaves the version unchanged. Allowed only on `active` cards.
  - `saveCardFields(env, user, id, fields: unknown, version: number): Promise<CardDTO>`.
    - Merges the sanitized fields, bumps the version and adds a `field` event whose detail lists the changed keys.
    - On a version mismatch → 409.
    - If designer `onHold` changed, queue the sheet update with `hold` = the new value (Task 6).
  - `continueCard(env, user, id, version: number): Promise<CardDTO>`.
    - Recheck `continueBlocker` (failure → 409 with the same message).
    - Set the card to `done` (`done_by`, `done_at`), clear `returned_*` and add a `continued` event with detail `{ "to": "<area>|Done" }`.
    - Normalize the job, so the next card activates and gets an `activated` event.
    - If every card of the docket is done, add a `completed` event and queue `comp = 1`.
  - `sendBackCard(env, user, id, targetStep: number, reason: string, version: number): Promise<CardDTO>`.
    - The reason is trimmed and must be ≥ 3 characters, else 400 `Write a reason (at least 3 characters).`.
    - `targetStep` must be an earlier step of the same job, else 400 `Choose an earlier area.`.
    - The target becomes `active` with `returned_reason`/`returned_by` set and `activated_at = now`.
    - The cards from target + 1 through the current card become `waiting`. Their `done_*` and claims are cleared; fields are kept.
    - Add a `sent_back` event with detail `{ "to": "<area>", "reason": "…" }` on the current card.
  - Concurrency: every mutation is one `UPDATE … WHERE id = ? AND version = ?`, followed by a check of `meta.changes`.
    - When 0 changes and the card has moved → 409 `This card was already moved by <full name of last actor>.`
    - Continue, send back and save-fields all increment the version.
  - Routes (all `requireAuth`; a non-acting user → 403 `You can't work on this card.`):
    - `POST /api/cards/:id/claim`
    - `PUT /api/cards/:id/fields` `{fields, version}`
    - `POST /api/cards/:id/continue` `{version}`
    - `POST /api/cards/:id/send-back` `{toStep, reason, version}`
    - After each mutation: `c.executionCtx.waitUntil(flushCardSheet(c.env, wo))` (Task 6). Until Task 6 lands, `queueCardSheet`/`flushCardSheet` exist as no-op stubs exported from `sheetSync.ts`.

- [ ] **Step 1: Write failing tests.**
  - Staff with `laminate_roll` presses Continue on an empty laminate card → 409 `Mark "Laminated" to continue`.
  - After saving `{laminated:true}`, Continue → 200. The next card is active and the events read `continued` then `activated`.
  - Send back from Laminate to step 0 with reason `Cut file missing`:
    - Step 0 is active with `returned.reason`.
    - Step 1 (Print Roll) is waiting with its fields kept.
    - Laminate is waiting.
  - Send back with reason `"  "` → 400. Send back with `toStep` equal to the current step → 400.
  - Two Continues with the same version: one gets 200, the other 409 with `already moved by`.
  - A staff user without the role → 403. A manager without the role → 200.
  - Continue on the last card of the last job → `completed` event, and `card_sheet_queue.comp = 1`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement the service functions and routes.
- [ ] **Step 4:** Run `npx vitest run`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: card actions — claim, fields, continue, send back`.

### Task 5: Reading cards — My Cards, card detail, Board, History, seen, sound

**Files:**
- Modify: `src/worker/cards/service.ts`, `src/worker/routes/cards.ts`
- Test: `test/worker/cards.test.ts`

**Interfaces:**
- Produces:
  - `listMyCards(env, user): Promise<CardDTO[]>`.
    - Returns the cards with status `active` that are visible to the user (the user has the role, and the card is a team card or the user is an assignee), plus `waiting` cards visible to the user as `Up next` (status waiting).
    - Excluded: dockets whose `virtual_dockets.deleted_at` is set, or whose mirror `dockets.status = 'cancelled'`.
    - One row per card, never one per role.
    - `isNew` = active and no `card_seen` row for the user with `seen_at >= activated_at`.
    - The header comes from the `dockets` mirror joined on work_order, `bucket` from `deriveTimeBucket`, and `proofRequired` from `virtual_dockets.form_json`.
  - `getCardDTO(env, user, id)`. 404 when the user can't see the card and is not a manager or admin.
  - `myCardsSummary(env, user): Promise<MyCardsSummary>`. Two `COUNT` queries plus `users.sound_on`.
  - `markSeen(env, user, id)`. Upserts `card_seen` with `now`.
  - `board(env, filters: { area?: string; userId?: number; bucket?: TimeBucket }): Promise<BoardDTO>`.
    - Active cards only, grouped by role in sort order, with the same exclusions as My Cards.
    - `noMembers` = team card and no active user has the role.
    - `productionColumnsReady` comes from `app_settings`.
  - `docketHistory(env, wo): Promise<CardEventDTO[]>`. Oldest first, with `area` from `AREA_LABEL`, `user` = full name, and `detail` human-readable:
    - `continued` → `Continue → Laminate`.
    - `sent_back` → `Sent back to Design · <reason>`.
    - `claimed` → `I'm on it`.
    - `field` → `Updated <labels>`.
    - `activated` → `Arrived`.
    - `completed` → `Docket completed`.
    - removal → `Removed <area> from the route`.
  - Routes:
    - `GET /api/my-cards` → `CardDTO[]`; `GET /api/my-cards/summary` → `MyCardsSummary`.
    - `GET /api/cards/:id`; `POST /api/cards/:id/seen`.
    - `GET /api/production-board?area=&user=&bucket=` (admin and manager).
    - `GET /api/virtual-dockets/:wo/history` (admin and manager; Staff → 403). Register it in `routes/cards.ts` with its own `requireLevel`, mounted before `virtualDocketRoutes`, so it does not hit `/:wo`.
    - `PUT /api/me/sound` `{on: boolean}`.

- [ ] **Step 1: Write failing tests.**
  - Erin (`printer_roll`) and Seb (`printer_roll` + `designer`) both see an active team Print Roll card.
  - The same card assigned to `[erin]` only: Seb no longer sees it.
  - Seb with two jobs, each with an active Print Roll card, sees 2 cards, not 4.
  - `isNew` is true before `POST /seen` and false after. A send-back later reactivates the card, so `isNew` is true again.
  - The summary `newCount` matches.
  - Cancelling a docket (via `POST /api/virtual-dockets/:wo/cancel`) removes its cards from My Cards and the Board. A trashed docket is removed too; restore brings it back.
  - Board: a team card whose role has no active user has `noMembers: true`.
  - History: a staff user gets 403. A manager gets ordered events, including `Sent back to Design · Cut file missing`.
  - `PUT /api/me/sound {on:false}` → the summary has `soundOn:false`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: My Cards, Production Board and docket history APIs`.

### Task 6: Google Sheet sync (Q–Z, Production tab, HOLD/COMP, setup)

**Files:**
- Modify: `src/worker/google/sheets.ts`, `test/worker/fakeGoogle.ts`, `src/worker/dockets/service.ts` (export `locateRow`), `src/worker/index.ts` (cron), `src/worker/routes/cards.ts`
- Create: `src/worker/cards/sheetSync.ts` (replaces Task 4 stubs)
- Test: `test/worker/cardSheet.test.ts`, `test/worker/gateways.test.ts`

**Interfaces:**
- `SheetGateway` additions. The real gateway uses `values:batchUpdate` and `batchUpdate`; the fake keeps tabs in `tabs: Record<string, unknown[][]>`, with `"Contempra"` aliased to `rows`, and `readRange` parsing the tab name before `!`.
  - `ensureTab(title: string): Promise<void>`: `addSheet` if missing (read titles via `spreadsheets.get?fields=sheets.properties.title`).
  - `writeRange(a1: string, values: unknown[][]): Promise<void>` (RAW).
  - `appendRows(tab: string, values: unknown[][]): Promise<void>` (`values:append`, RAW, `INSERT_ROWS`).
  - `clearColumns(fromCol: string, toCol: string, fromRow: number): Promise<void>`: on the Contempra tab, a `repeatCell` with empty cell and `fields: "userEnteredValue,dataValidation"`. This removes old checkboxes so text fits.
- `PRODUCTION_HEADERS = ["Work Order","Job","Step","Role","Assigned To","Status","Fields","Returned Reason","Updated By","Updated At"]`; `STAGE_HEADERS = ["Stage","Design","Print Roll","Print FB","Laminate","Liquid Lam","Colex","Finishing","Install","Assigned"]` (Q..Z).
- `queueCardSheet(db, wo, patch?: { hold?: 0|1; comp?: 1 }): Promise<void>`: upsert; patches merge, and a later non-null value wins.
- `flushCardSheet(env, wo): Promise<void>`. Never throws; records failures in the queue row.
  1. If `app_settings.production_columns != 'ready'` → return and keep the queue.
  2. `withLock(db, SHEET_LOCK)`: `locateRow(env, wo)`.
  3. Build cells:
     - `Q` = `stageText`.
     - `R..Y` = `areaCellText` of the docket's card for that area. Multiple jobs in one area: join the texts with ` | `.
     - `Z` = names of the claimers of active cards, or `Team` / assignee names.
     - `D` = TRUE when `comp = 1`; `E` = hold when it is set.
  4. `updateCells`.
  5. Upsert the `Production` rows: read `Production!A2:C`, update each matching `(WO, Job, Step)` row in place with `writeRange`, and append the missing rows. A card deleted by reconcile gets Status `Removed`.
  6. Upsert the mirror via the existing `upsertMirror` (export it), delete the queue row, and on error set `attempts + 1` and `last_error`.
- `retryCardSheet(env): Promise<void>`: flushes up to 20 queued dockets, oldest first. It runs on the `*/5` cron after `retryPendingDrive`.
- `setupProductionColumns(env, user): Promise<{ archivedRows: number }>`. Admin only, under the sheet lock.
  1. If `Contempra!Q1` already equals `Stage` → 409 `Production columns are already set up.`.
  2. Read `Contempra!C1:C` and `Q1:Y`.
  3. `ensureTab("Legacy Q-Y")` and write the header `Work Order` + the old Q1..Y1, then every row with any non-empty Q..Y value, prefixed with its WO.
  4. `clearColumns("Q","Z",2)`, then write `STAGE_HEADERS` to `Q1:Z1`.
  5. `ensureTab("Production")` and write `PRODUCTION_HEADERS`.
  6. Set `app_settings.production_columns = 'ready'` and queue every docket that has cards.
  - Route: `POST /api/admin/production-columns` with `{confirm: "SET UP"}`, else 400.
- Every card mutation (Task 4) and reconcile (Task 3) calls `queueCardSheet`, followed by a flush via `waitUntil`.

- [ ] **Step 1: Write failing tests.**
  - Gateway (real, with `__setGoogleFetch`): `clearColumns` sends `repeatCell` with `dataValidation` in `fields`. `appendRows` hits `:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`.
  - Setup: a FakeSheet with Q1:Y1 old headers and two rows with legacy data.
    - Afterwards `Legacy Q-Y` holds the WO plus the data.
    - Q2:Y2 are empty, and Q1:Z1 = `STAGE_HEADERS`.
    - A second call → 409.
    - A body without `confirm` → 400.
  - Before setup, Continue leaves a queue row and does not change the sheet.
  - After setup, Continue on Print Roll → row Q = `Laminate`, S = `✓ <name> MM/DD`, U = `Active · Team`. The `Production` tab has 3 rows for the docket.
  - `failNext("updateCells")` during the flush: the card still moved, the queue row has `attempts = 1` and `last_error` set, and `retryCardSheet` then writes the sheet and clears the row.
  - The last Continue sets `D` = TRUE. Designer `onHold` true sets `E` = TRUE.
- [ ] **Step 2:** Run `npx vitest run test/worker/cardSheet.test.ts test/worker/gateways.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: production stage in Google Sheet (Q–Z, Production tab)`.

### Task 7: Card UI (tile + full card)

**Files:**
- Create: `src/web/cards/CardTile.tsx`, `src/web/cards/CardView.tsx`, `src/web/cards/fields.tsx`
- Test: `test/web/cardView.test.tsx`

**Interfaces:**
- Consumes: `CardDTO`, `CARD_FIELDS`, `continueBlocker`, `continueLabel`, `AREA_LABEL` (Task 2); the routes from Tasks 4–5.
- Produces:
  - `CardTile({ card, onOpen }: { card: CardDTO; onOpen: () => void })`. Square glass tile (reuse `tile` utility) showing:
    - `#<WO>`, customer, job name and bucket chip.
    - A `NEW` label and a glow ring when `isNew`.
    - A red strip `Returned by <by> · <reason>` when returned.
    - `<first name> is working on it` when claimed.
    - Waiting cards are dimmed with `Up next`.
  - `CardView({ card, onClose }: { card: CardDTO; onClose: () => void })`. Glass modal like `DocketDetail`.
    - Content: the header (spec §5 common header), the returned strip, the field editors from `fields.tsx`, and the buttons.
    - Opening it calls `POST /seen`.
    - Field edits save via `PUT /fields` after a 1 s debounce (`useDebounced`) and carry the version.
    - Continue is disabled while `continueBlocker` returns non-null; the message shows under the button (`role="status"`).
    - When `sendBackToDesign` is set, a `Send back to Design` shortcut opens Send back with the first `designer` step in `earlier` preselected (else the first earlier step) and the reason prefilled with the blocker's field label (`File missing` / `Cut file missing`).
    - `← Send back` opens an inline panel: a radio list of `earlier` areas, a `Reason` textarea and a `Send back` button that stays disabled until the reason is ≥ 3 characters. The button is hidden when `earlier` is empty.
    - `I'm on it` is shown on active, unclaimed cards (or claimed by someone else).
    - Waiting cards are read-only, with no buttons.
    - A 409 shows the server message, and the card refetches.
    - Catalog fields: `material` uses the Roll materials list (`data/catalogs/roll-print-materials.json`, imported statically) with free text allowed (`<input list>`). `machine` is free text with a datalist of the machines already used.

- [ ] **Step 1: Write failing tests (jsdom, `mockApi`).**
  - A Laminate card next = finishing: the button reads `Continue → Finishing` and is disabled, with `Mark "Laminated" to continue`. Ticking Laminated enables it. After the debounce, `PUT /api/cards/7/fields` is sent with `{fields:{laminated:true}, version:0}`.
  - A designer card shows `Send to production →`.
  - Send back: the button is disabled with an empty reason. Choose `Design`, type `Wrong size`, click → `POST /send-back` `{toStep:0, reason:"Wrong size", version}`.
  - A printer card with File = Missing shows `Send back to Design`. Clicking it prefills `File missing`.
  - A returned card shows `Returned by Seb · Cut file missing`.
  - A 409 response text is shown.
  - Opening the card calls `POST /api/cards/7/seen`.
- [ ] **Step 2:** Run `npx vitest run test/web/cardView.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat: production card view`.

### Task 8: My Cards page + notifications

**Files:**
- Modify: `src/web/pages/MyCards.tsx`, `src/web/components/Layout.tsx`
- Create: `src/web/cards/useCardAlerts.ts`, `src/web/cards/chime.ts`
- Test: `test/web/myCards.test.tsx`

**Interfaces:**
- Produces:
  - `playChime(): void`. Web Audio, two sine tones (880 Hz then 1320 Hz, 0.15 s each, quick decay). It reuses one `AudioContext`, created or resumed on the first `pointerdown` anywhere (listener registered once). It no-ops silently when audio is unavailable.
  - `useCardAlerts(): { newCount: number; soundOn: boolean; setSoundOn(on: boolean): void }`.
    - Uses `useQuery(["my-cards-summary"])` with `refetchInterval: 20_000` and `refetchIntervalInBackground: true`, enabled for any signed-in user.
    - When `newCount` rises above the previous value and `soundOn` → `playChime()`, and invalidates `["my-cards"]`.
    - Sets `document.title` to `(N) New cards · Contempra` when N > 0, else restores the base title.
  - Layout:
    - The `My Cards` nav item (sidebar and mobile bar) shows a bold red badge with `newCount`, with the class `animate-pulse-badge`, a new `@utility` keyframe `scale 1→1.15` + ring. It pulses while N > 0.
    - The user box gets a `Sound on` / `Sound off` toggle (44px) that calls `PUT /api/me/sound`.
    - Managers and admins get a `Production Board` nav item (`/production`).
  - The My Cards page:
    - Role tabs when the user has more than one role (plus `All`).
    - Groups in this order: `Returned`, `Rush / Today`, `This Week`, `Coming`, `No Due Date`, then `Up next` (waiting). Empty groups are hidden.
    - Clicking a tile opens `CardView`. The empty state reads `No cards right now.`

- [ ] **Step 1: Write failing tests.**
  - The summary goes from `{newCount:0}` to `{newCount:2}` (advance fake timers 20 s): the chime is called once (mock `chime.ts`), the badge shows `2`, and `document.title === "(2) New cards · Contempra"`.
  - With `soundOn:false`, the chime is not called.
  - The groups render in order, and a returned card sits under `Returned`.
  - A user with roles `printer_roll` + `designer` sees the tabs `All`, `Designer`, `Printer Roll`. Filtering works.
  - Clicking a tile opens the card.
  - Staff do not see the `Production Board` nav item; managers do.
- [ ] **Step 2:** Run `npx vitest run test/web/myCards.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: My Cards with sound, badge and tab alerts`.

### Task 9: Production Board, docket History tab, route chips, setup button

**Files:**
- Create: `src/web/pages/ProductionBoard.tsx`, `src/web/components/DocketHistory.tsx`
- Modify: `src/worker/cards/service.ts` + `src/worker/routes/cards.ts` (board `wo` filter), `src/web/App.tsx` (route `/production`, managers), `src/web/components/DocketDetail.tsx`, `src/web/docket/ProductionPanel.tsx`, `src/web/pages/AdminUsers.tsx`, `src/worker/db/dockets.ts` + `src/shared/types.ts` (`vendorPickup` on `DocketSummary`), `src/web/components/DocketList.tsx`
- Test: `test/web/productionBoard.test.tsx`, `test/worker/dockets.test.ts`

**Interfaces:**
- Board page:
  - Horizontal columns (scroll inside the board, not the page) with the heading `<Area> (<n>)`.
  - Filters: Area select, Person select (from `/api/assignees`), and time-group chips.
  - Tiles reuse `CardTile`. Returned cards keep the red strip. `noMembers` shows `No one has this role`.
  - When `productionColumnsReady` is false and the user is admin, a banner reads `Production columns are not set up in the Google Sheet yet.` with a link to Users.
- `DocketDetail` tabs:
  - `Details` (existing) · `Production` (each job's steps with status chips: `Done ✓ <name>`, `Active`, `Returned`, `Pending`; data from `GET /api/virtual-dockets/:wo` jobs plus `/api/production-board?wo=`).
    - **Decision:** add an optional `wo` filter to the board endpoint and return all statuses when `wo` is set.
  - `History` (managers and admins only), using `DocketHistory` to render `CardEventDTO[]` as `Nov 9, 2:14 PM · Print Roll · Seb · Continue → Laminate` in Winnipeg time.
- `ProductionPanel` chips: `<Role> · Team` when there are no assignees, else `<Role> · <first names joined by ", ">`.
- `AdminUsers`: a `Set up production columns` button opens a confirm dialog. The text: `This copies columns Q–Y to a new "Legacy Q-Y" tab, clears them, and writes the new production headers. Type SET UP to continue.` On success it shows `Done. <n> rows archived.` and hides the button when ready.
  - **Decision:** `/api/production-board` returns `productionColumnsReady`, which serves as the flag.
- `vendorPickup` on `DocketSummary` = EXISTS a `finishing` card of the docket with `json_extract(fields_json,'$.vendorPickup') = 1` and `coalesce(json_extract(fields_json,'$.packaged'),'') != 'shipped'`. `DocketList` tiles show a `Vendor pickup ready` chip.

- [ ] **Step 1: Write failing tests.**
  - The Board renders `Laminate (2)` with 2 tiles. The Person filter adds `user=` to the request. `noMembers` text shows.
  - A Staff user gets no History tab in DocketDetail. A manager sees `Sent back to Design · Cut file missing`.
  - The ProductionPanel chip reads `Printer Roll · Team`.
  - The setup button is disabled until `SET UP` is typed, then posts `{confirm:"SET UP"}`.
  - Worker: `listDockets` returns `vendorPickup: true` for a docket whose finishing card has `vendorPickup` and is not shipped.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run` and `npx tsc -b`. Expected: PASS, no type errors.
- [ ] **Step 5:** Commit `feat: Production Board, docket history and setup button`.

### Task 10: Whole-flow check and publish

**Files:** none new (fix whatever the checks find, with a test first).

- [ ] **Step 1:** Run `npx vitest run`, `npx tsc -b` and `npm run build`. Expected: all green.
- [ ] **Step 2: Walk the flow in the local preview** (`preview_start`, seeded via `scripts/dev-setup.mjs`) with two `printer_roll` users plus a manager.
  - Create a docket with the route Designer → Printer Roll (Team) → Laminate Roll → Finishing.
  - Designer: `Send to production →`. Erin's My Cards plays the chime and shows a badge within 20 s.
  - Seb presses `I'm on it`; Erin sees `Seb is working on it`.
  - Seb Continues with File OK.
  - Laminate sends back to Design with a reason, and the red strip appears.
  - Re-run to Finishing → Shipped → `Continue → Done`.
  - The manager History tab lists every step with times.
  - Screenshots at 1024×1366 and 375×812.
- [ ] **Step 3:** The user runs `powershell -ExecutionPolicy Bypass -File scripts/publish.ps1`; migration 0004 applies remotely.
  - Admin clicks `Set up production columns` on the TEST sheet ("Workorder Books TEST").
  - Check that `Legacy Q-Y`, the Q–Z headers and the `Production` tab exist, and that a test docket's walk-through updates Q–Z.
- [ ] **Step 4:** Commit any fixes, then hand off with the finishing-a-development-branch skill.
