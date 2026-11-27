# Main Dashboard header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the clock, three personal cards (Overdue task cards, At risk, Waiting on you) and the Areas · Open board menu to the Main Dashboard header, laid out exactly like the owner's composition.

**Architecture:** Pure rules and copy in `src/shared/dashboard.ts`. SQL fragments for the personal rules in one worker module (`src/worker/dashboard/rules.ts`) used by both the new `GET /api/dashboard/summary` and the `focus` filter of `GET /api/dockets`. The web header is split into `Clock`, `PersonalCard`, `AreaMenu` and `DashboardHeader`, placed by one CSS grid with named areas per breakpoint.

**Tech Stack:** Hono + D1 (worker), React 18 + TanStack Query 5 + Tailwind v4 (web), Vitest (workers pool + jsdom).

**Spec:** `docs/superpowers/specs/2026-11-27-dashboard-header-design.md`

## Global Constraints

- UI copy, code, comments and commits in English; chat with the owner in Spanish.
- Free plan only; no new polling loop (the summary refetches every 30 s like the list).
- No Google Sheet change, no migration.
- Tokens: primitives → semantic → component in `src/web/index.css`; custom utilities with `@utility`.
- AA contrast in light and dark; `prefers-reduced-motion` respected (global rule already in CSS).
- No horizontal scroll at any width (1440, 1024, 375).
- Winnipeg dates via `todayInBusinessTz` / `BUSINESS_TZ`.
- Thresholds: task overdue after **24 h** (or due date before today); New Order stale after **48 h**.
- Commit footer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Decisions taken (owner pre-approved reasonable choices)

1. **Focus filters.** `GET /api/dockets?focus=risk|waiting`. Focus is personal: when set, the server ignores `mine` / `list`. The web keeps it in the URL (`?focus=`), shows a dismissible chip (`At risk ×` / `Waiting on you ×`), forces the Active view, and clears it when the scope or view changes. Clicking At risk also switches the scope to My Dockets when the user has codes (spec: "My Dockets + Active").
2. **At risk** = active dockets (status `active`) whose J is one of my codes and `due_rush = 1 OR due_iso <= today`. `overdue` = `due_iso < today`; `dueToday` = the rest (RUSH counts as due today).
3. **Waiting on you** (all on live dockets: saved, not in Trash, not cancelled):
   - (a) `virtual_dockets.new_order = 1`, `created_by = me`, `updated_at` older than 48 h, docket status `active`;
   - (b) active cards with `stage IN ('waiting_design','waiting_sample')` naming me in `assignee_ids`;
   - (c) active cards with `returned_reason IS NOT NULL` naming me in `assignee_ids` or `claimed_by = me`.
   Counts: (a) dockets, (b) and (c) cards. Filter: dockets in the union.
4. **Overdue task cards** = `to_user = me AND from_user != me AND status = 'open' AND (created_at < now − 24 h OR (due_kind = 'date' AND due_date < today))`. Oldest = smallest `created_at`; `oldestDays` = whole days since; `oldestFrom` = sender's first name.
5. **Area counts** = active cards on live dockets grouped by `role_id` (the Board rule), every `ROLE_ORDER` area listed, zeros included, no General.
6. **AreaLegend** is replaced on the dashboard by the Areas menu (same names on the same tints, so the legend survives).
7. **My Cards** accepts `?show=task` so the Overdue card can open it on the Task cards filter.
8. **Production Board** `?area=<roleId>` scrolls that column into view and highlights it for 1.6 s (`data-highlight`), without filtering.

## Review Focus

- A user with **no codes**: At risk is 0 (no crash), `focus=risk` returns an empty list.
- A docket **in Trash or cancelled** with a sent-back card or waiting stage: not counted in Waiting.
- A **note to self** older than 24 h: never counted in Overdue task cards.
- **Phone 375 px**: three cards + 11 area buttons do not overflow sideways (noSideScroll test).
- The clock **crosses midnight / a minute boundary**: re-renders with the new weekday/date.

---

### Task 1: Pure rules and copy (`src/shared/dashboard.ts`)

**Files:**
- Create: `src/shared/dashboard.ts`
- Modify: `src/shared/types.ts` (add `DashboardSummary`)
- Test: `test/shared/dashboard.test.ts`

**Interfaces — Produces:**
- `TASK_OVERDUE_HOURS = 24`, `NEW_ORDER_STALE_HOURS = 48`
- `hoursAgoIso(now: Date, hours: number): string`
- `wholeDaysSince(iso: string, now: Date): number`
- `firstName(full: string | null | undefined): string`
- `overdueDetail(s: DashboardSummary["overdueTasks"]): string` → `"All caught up"` | `"Oldest: 4 days · from Jeff"` (`1 day` singular)
- `riskDetail(s: DashboardSummary["atRisk"]): string` → `"5 overdue · 2 due today"`; at 0 → `"Nothing overdue"`
- `waitingDetail(s: DashboardSummary["waiting"]): string` → parts `"<a> new order(s)"`, `"<b> approval(s)"`, `"<c> sent back"`, zero parts omitted, joined by `" · "`; all zero → `"Nothing waiting"`
- `clockParts(now: Date): { time: string; weekday: string; date: string; label: string }` → for 2026-11-27T14:00Z: `{ time: "8:00 AM", weekday: "FRIDAY", date: "Nov 27, 2026", label: "Friday, November 27, 2026, 8:00 AM" }`
- `type DashboardSummary = { overdueTasks: { count: number; oldestDays: number | null; oldestFrom: string | null }; atRisk: { overdue: number; dueToday: number }; waiting: { newOrders: number; approvals: number; sentBack: number }; areas: { roleId: string; count: number }[] }`
- `type DashFocus = "risk" | "waiting"`, `DASH_FOCUS: DashFocus[]`

- [ ] Step 1: tests for every function above with the exact strings listed (incl. singular/plural, zero states, Winnipeg time across UTC midnight: 2026-11-28T03:30Z → `9:30 PM`, `FRIDAY`).
- [ ] Step 2: run `npx vitest run test/shared/dashboard.test.ts` → FAIL (module missing).
- [ ] Step 3: implement with `Intl.DateTimeFormat` in `BUSINESS_TZ`.
- [ ] Step 4: run → PASS. Commit `feat: dashboard header rules and copy`.

### Task 2: Summary endpoint and focus filter (worker)

**Files:**
- Create: `src/worker/dashboard/rules.ts`, `src/worker/routes/dashboard.ts`
- Modify: `src/worker/db/dockets.ts` (`DocketQuery.focus`), `src/worker/routes/dockets.ts` (parse `focus`), `src/worker/index.ts` (mount)
- Test: `test/worker/dashboardSummary.test.ts`

**Interfaces:**
- Consumes: Task 1 constants, `hoursAgoIso`, `wholeDaysSince`, `firstName`, `DashboardSummary`, `DASH_FOCUS`.
- Produces:
  - `riskWhere(codesParam: string): string` (SQL on `dockets`, uses `:today`)
  - `waitingWorkOrdersSql(): string` (SELECT work_order union, params `:me`, `:staleBefore`)
  - `dashboardSummary(db: D1Database, user: SessionUser, now: Date): Promise<DashboardSummary>`
  - `GET /api/dashboard/summary` (admin/manager, 401 without session)
  - `listDockets(..., { focus?: DashFocus, codes, viewerId })`: `risk` → codes filter + `riskWhere`; `waiting` → `work_order IN (waiting union)`; scope filters ignored. Invalid focus → 400 `Invalid filter`.

- [ ] Step 1: worker tests (setupCards, handDocket, `user_codes` inserts, direct D1 updates for timestamps):
  - overdue tasks: counts a 25 h old task from Jeff, a task due yesterday; excludes a 2 h old one, a note to self 3 days old, a done one, a task to someone else; `oldestDays` 3, `oldestFrom` first name.
  - at risk: my code, due yesterday → overdue 1; RUSH → dueToday; due tomorrow, on hold, other's code → excluded; user without codes → `{0,0}`.
  - waiting: New Order of mine 3 days old counted, 1 day old not; proof sent → approvals 1; send back to me → sentBack 1; same docket moved to Trash → not counted.
  - areas: 11 entries in ROLE_ORDER, counts equal Board column lengths.
  - `/api/dockets?focus=risk` and `focus=waiting` return exactly those work orders even with `mine=1`/`list=1`; `focus=bogus` → 400.
- [ ] Step 2: run → FAIL.
- [ ] Step 3: implement (4 queries in one `db.batch`).
- [ ] Step 4: run file, then whole suite → PASS. Commit `feat: dashboard summary and focus filters (API)`.

### Task 3: Tokens and header grid (CSS)

**Files:**
- Modify: `src/web/index.css`
- Test: `test/web/dashboardContrast.test.ts`

**Interfaces — Produces:** semantic tokens per hue `amber|red|blue`: `--veil-<hue>-from`, `--veil-<hue>-to`, `--veil-<hue>-edge`, `--veil-<hue>-title`, `--veil-<hue>-num`, `--veil-<hue>-detail` (light + dark); utility `veil` (+ `data-hue`, `data-calm`); class `.dash-head` with grid areas `title actions clock sel cards areas chips`.

- [ ] Step 1: contrast test (pattern of `segmentedContrast.test.ts`): title, num, detail ≥ 4.5:1 against both veil stops, light and dark.
- [ ] Step 2: run → FAIL. Step 3: add tokens + utility + grid. Step 4: PASS. Commit with Task 4.

### Task 4: Header components and Dashboard wiring (web)

**Files:**
- Create: `src/web/dashboard/Clock.tsx`, `PersonalCard.tsx`, `AreaMenu.tsx`, `DashboardHeader.tsx`
- Modify: `src/web/pages/Dashboard.tsx`, `src/web/pages/MyCards.tsx` (`?show=`), `src/web/pages/ProductionBoard.tsx` (`?area=`), `src/web/components/Icon.tsx` (icons `clock`, `alert`, `inbox`, `grid` if missing)
- Test: `test/web/dashboardHeader.test.tsx`; update `test/web/dashboard.test.tsx` / `noSideScroll.test.tsx` mocks with `/api/dashboard/summary`

**Interfaces — Consumes:** Task 1 copy helpers, `DashboardSummary`, `/api/dashboard/summary`, `focus` param.

- [ ] Step 1: web tests:
  - clock shows `8:00 AM`, `FRIDAY`, `Nov 27, 2026`, `aria-label` full date; advancing fake timers 60 s shows `8:01 AM`.
  - three links: `Overdue task cards` → `/my-cards?show=task`; `At risk` → `?focus=risk`; `Waiting on you` → `?focus=waiting`; numbers and detail lines from the summary.
  - clicking At risk requests `/api/dockets` with `focus=risk`, shows `At risk` chip; dismissing it removes `focus`.
  - Areas menu: 11 links `/production?area=<roleId>` with counts; on phone the toggle `Areas · Open board` starts collapsed (`aria-expanded=false`), toggling persists in `localStorage["dashboard.areasOpen"]`.
  - My Cards `?show=task` starts on Task cards; Board `?area=laminate_roll` calls `scrollIntoView` and sets `data-highlight` on that column.
- [ ] Step 2: run → FAIL. Step 3: implement. Step 4: whole suite + typecheck → PASS.
- [ ] Step 5: commit `feat: dashboard header with clock, personal cards and areas menu`.

### Task 5: Visual check and review

- [ ] Preview (`npm run dev`, local D1 seeded) at 1440, 1024, 375 px, light and dark; compare with the owner's image; screenshots.
- [ ] Fresh reviewer on the whole branch; fix what matters; suite + typecheck green.
- [ ] Update `CLAUDE.md` (status + test count). Ask "¿Hago merge a main y publico?".
