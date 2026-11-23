# Docket Hand-off Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed area route with a hand-to-hand flow: each person passes the docket to the next person(s) with a "What to do" note, finishes back to the creator, and the creator closes it.

**Architecture:** Cards stay the unit of work (`cards` table). New-style cards (`handoff = 1`) belong to one person, remember who handed them over (`from_user_id`, `from_card_id`) and carry an `instruction`. One "creator card" per docket (`stage` not null, role `general`) is what returns to the creator (`ready_to_close`, `waiting_design`, `waiting_sample`). The worker logic lives in a new `src/worker/cards/handoff.ts`; pure rules in `src/shared/handoff.ts`. The legacy route API (`jobs` with steps) is kept only so existing dockets and old tests keep their cards; the UI no longer sends it.

**Tech Stack:** Cloudflare Workers + D1, Hono, React 18, TanStack Query, Vitest (workers pool + jsdom).

**Spec:** `docs/superpowers/specs/2026-11-23-docket-handoff-flow-design.md` (STATUS column part already done, layout `v5`).

## Global Constraints

- All UI text, errors, sheet text, code and commits in English.
- Free tiers only; no new polling.
- TDD: failing test first; whole suite green before each commit.
- New migration is `migrations/0009_handoff.sql`; never edit applied ones.
- Sheet letters stay logical (A–P, Q–AB, `STATUS_KEY`); never hard-code shifted letters.
- Every move bumps `version`; a concurrent move gets 409 `This card was already moved by <name>.`
- Tracking line format: `<Name> - <what> - November 23 2026 - 9:37 AM` (Winnipeg).
- STATUS texts exactly: `Starting`, `In progress`, `Returned`, `Ready to close`, `Waiting for design approval`, `Waiting for sample approval`, `Done`.
- Buttons exactly: `I'm on it`, `Continue →`, `Done`, `← Send back`, `Close docket`, `Restore`, `Proof sent`, `Sample sent`, `Approved → Continue`. "Send to production →" is gone.

## Data model (migration 0009)

- `INSERT INTO roles (id, label, sort) VALUES ('general', 'General', 99)`; `listRoles` excludes it (cannot be given to users).
- `cards` new columns: `instruction TEXT`, `from_user_id INTEGER`, `from_card_id INTEGER`, `stage TEXT` (creator card only), `handoff INTEGER NOT NULL DEFAULT 0`.
- `card_events` rebuilt with CHECK actions + `done`, `proof_sent`, `sample_sent`, `approved`, `closed`, `restored`.
- New cards: `job_sort = 0`, `job_name = 'Whole docket'`, `step = max(step)+1` of the docket (keeps the UNIQUE key).

Event details (new): `activated {assignees:[id], from:userId}` (or `{assignees, returned:true}` on a send back: no tracking line); `continued {to:[{userId, roleId, instruction}]}`; `done|proof_sent|sample_sent {back:creatorId}`; `sent_back {toUser, reason}`; `approved {}`, `closed {}`, `restored {}`. Legacy details (`to: "<Area>"`) keep their old text.

## Review Focus

1. Split branches: Close must refuse (409 `Other people still have this docket open.`) while any non-creator card is active.
2. A send back parks my card (`waiting`); a later Continue to the same person + area reuses it (fields kept) instead of creating a twin.
3. Legacy dockets: an active route card can Continue/Done with the new buttons; legacy `waiting` cards are removed on the first hand-off action.
4. A person with no area must get a `general` card; a person with areas must pick one of their own areas (400 otherwise).
5. Restore of a closed docket clears COMP (queue `comp: 0` writes D = false).

---

### Task 1: Migration and pure hand-off rules

**Files:**
- Create: `migrations/0009_handoff.sql`, `src/shared/handoff.ts`
- Modify: `src/shared/cards.ts` (labels for `general`; drop `continueLabel`), `src/worker/routes/users.ts` (`listRoles` excludes `general`)
- Test: `test/shared/handoff.test.ts`

**Interfaces — Produces (`src/shared/handoff.ts`):**
- `GENERAL_ROLE = "general"`
- `type CardStage = "ready_to_close" | "waiting_design" | "waiting_sample"`
- `STAGE_STATUS: Record<CardStage, string>` (`Ready to close`, `Waiting for design approval`, `Waiting for sample approval`)
- `approvalKind(roleId): "proof" | "sample" | null` (designer → proof; printer_roll, printer_fb, laminate_roll, liquid_lam → sample)
- `type HandoffTarget = { userId: number; roleId: string; instruction: string }` (roleId is `general` for people without areas)
- `parseTargets(raw: unknown, people: { id: number; name: string; roles: string[] }[]): HandoffTarget[]` throws `Error` with message: `Choose at least one person.`, `Choose an area for <name>.`, `Write what to do for <name>.`; dedupes same user+role; max 10; instruction trimmed, max 300.

- [ ] Write tests for `approvalKind`, `parseTargets` (no-area → general; wrong area → error; missing note → error; dedupe), and `ROLE_LABEL.general === "General"`.
- [ ] Run `npx vitest run test/shared/handoff.test.ts` → FAIL.
- [ ] Implement; write the migration (rebuild `card_events` via new table + copy + drop + rename + index).
- [ ] Run whole suite → PASS. Commit `feat: hand-off data model and rules`.

### Task 2: Starting a docket and who sees a card

**Files:**
- Create: `src/worker/cards/handoff.ts`
- Modify: `src/worker/dockets/service.ts` (create/update accept `handoff`; update without `jobs` leaves cards alone), `src/worker/routes/virtualDockets.ts` (body `handoff`), `src/worker/cards/actions.ts` (`canAct`), `src/worker/cards/read.ts` (`VISIBLE_TO`, parked cards hidden), `src/shared/types.ts` (`VirtualDocketDTO.inProduction: boolean`)
- Test: `test/worker/handoff.test.ts`

**Interfaces — Produces:**
- `loadPeople(db): Promise<{id; name; roles}[]>` (active users)
- `startHandoff(db, wo, actorId, targets: HandoffTarget[], now): Promise<void>` — 409 `This docket is already in production.` when the docket has any card; inserts active cards (`handoff=1`, `from_user_id=actor`, `instruction`), logs `activated {assignees, from}`, queues the sheet.
- `canAct`: assignees non-empty → user must be one of them (any role); empty (legacy team) → user has the role; admin/manager always.

- [ ] Tests: create docket with `handoff` → one active card per target with instruction; Ira (no role) gets `general` card and sees it in `/api/my-cards`; update with `handoff` on a docket with cards → 409; update without `jobs` keeps cards.
- [ ] Run → FAIL. Implement. Run suite → PASS. Commit `feat: start a docket by handing it to people`.

### Task 3: Card moves

**Files:**
- Modify: `src/worker/cards/handoff.ts`, `src/worker/cards/actions.ts` (old `continueCard` removed; legacy send back kept for cards without `from_user_id`), `src/worker/routes/cards.ts`
- Test: `test/worker/handoff.test.ts`

**Interfaces — Produces (routes, body always carries `version`):**
- `POST /api/cards/:id/continue {to: HandoffTarget[]}` → `continueTo` — blockers apply (non-creator cards); my card done; for a waiting creator card logs `approved` first; each target reuses a parked card of the same person+role or gets a new one; legacy waiting cards removed.
- `POST /api/cards/:id/done` → `finishCard(kind="done")`; blockers apply; 400 `Use Close docket or Continue.` on the creator card.
- `POST /api/cards/:id/proof-sent` / `sample-sent` → `finishCard("proof"|"sample")`; 400 `This card can't send a proof.` / `sample.` when `approvalKind` differs; no blockers.
- `finishCard` → my card done; creator card (created_by, else updated_by) upserted active with stage (`ready_to_close` never overwrites a waiting stage), `from_user_id = me`, `from_card_id = my card`, returned/claim cleared; logs `done|proof_sent|sample_sent {back}` and `activated {assignees, from}` on the creator card.
- `POST /api/cards/:id/send-back {reason}` (new cards) → my card parked `waiting`; target = `from_card_id` card if any, else the creator card; target reopened active with `returned_reason`; logs `sent_back {toUser, reason}` + `activated {returned:true}`. Legacy cards keep `{toStep, reason}`.
- `POST /api/cards/:id/close` → only `stage = 'ready_to_close'`; 409 `Other people still have this docket open.`; creator card done; waiting cards deleted; logs `closed`; queue `comp: 1`.
- `POST /api/cards/:id/restore` (admin only, 403 otherwise) → done card back to active (creator card → `ready_to_close`); logs `restored`; queue `comp: 0` when the docket had no active card.

- [ ] Tests (one each): continue to two people (split), 409 on stale version, done → creator `Ready to close`, proof sent → creator waiting; approved continue; creator send back reopens designer card with reason; send back then continue reuses parked card; close blocked by open branch; close sets comp; restore (admin ok, staff 403, comp 0); legacy active card continue removes waiting cards.
- [ ] Run → FAIL. Implement. Rewrite old continue tests in `cards.test.ts` etc. to the new body. Suite → PASS. Commit `feat: hand-off card moves`.

### Task 4: Sheet — ROLE/STATUS, Docket Tracking, COMP

**Files:** Modify `src/worker/cards/sheetSync.ts` (select `stage`, `from`; `holderStatus`; `trackingText` new lines + `created` line from `virtual_dockets`; `q.comp === 0` → `D = false`), `src/worker/cards/sheetSync.ts` `queueCardSheet` patch `comp?: 0 | 1`.
**Test:** `test/worker/cardSheet.test.ts`

- [ ] Tests: `trackingText` produces the spec example lines (`created`, `received from Mike`, `sent to Sebastian (Print 2 banners 3x6)`, `returned to Ira (Wrong size)`, `done, back to Mike`, `proof sent, back to Mike`, `sample sent, back to Mike`, `approved`, `closed`, `restored`); creator card K = creator, STATUS `Ready to close` / `Waiting for design approval`; split shows `Sebastian, Ira` / `In progress, Starting`.
- [ ] FAIL → implement → suite PASS. Commit `feat: hand-off states and tracking in the sheet`.

### Task 5: DTO, history and board

**Files:** Modify `src/shared/types.ts` (`CardDTO` + `instruction`, `from: {id; name} | null`, `stage`, `approval`, `handoff`), `src/worker/cards/dto.ts`, `src/worker/cards/read.ts` (`describe` for new actions; board adds a `general` column last).
**Test:** `test/worker/cardsRead.test.ts`

- [ ] Tests: DTO fields; history texts (`Continue → Sebastian`, `Done, back to Mike`, `Proof sent`, `Sample sent`, `Approved`, `Docket closed`, `Restored`, `Sent back to Ira · <reason>`); board has a `General` column.
- [ ] FAIL → implement → PASS. Commit `feat: hand-off card details for the app`.

### Task 6: Web

**Files:**
- Create: `src/web/cards/HandoffPicker.tsx` — rows of `{person select (optgroups per area, "Other" for no area; value "<id>:<roleId>"), What to do textarea}`, `+ Add person`, remove row.
- Modify: `src/web/pages/DocketEditor.tsx` (`Send to` panel with HandoffPicker when new or `inProduction === false`; body sends `handoff`, not `jobs`; Save disabled until each row is complete on a new docket), `src/web/cards/CardView.tsx` (What to do + From banner; buttons per state; continue sheet with HandoffPicker; Send back shows `Send back to <name>`), `src/web/components/DocketHistory.tsx` (admin `Restore` on done cards), `src/web/cards/CardTile.tsx` (stage label).
- Delete: `src/web/docket/ProductionPanel.tsx` (no longer used).
- Test: `test/web/handoffPicker.test.tsx`, `test/web/cardView.test.tsx`, `test/web/docketEditor.test.tsx`

- [ ] Tests: picker groups people by area and Other; editor posts `handoff`; card shows What to do; Continue posts `{to, version}`; Done posts `/done`; designer shows `Proof sent`; creator card shows `Close docket`/`Approved → Continue`.
- [ ] FAIL → implement → PASS; typecheck; check 375 px in preview. Commit `feat: hand-off flow in the app`.

### Task 7: Docs and verification

- [ ] Update CLAUDE.md (domain rules, test count), mark spec implemented.
- [ ] `npx vitest run`, `npm run typecheck` green. Fresh reviewer on the branch; fix what matters. Commit `docs: hand-off flow`.
