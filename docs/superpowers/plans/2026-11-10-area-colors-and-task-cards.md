# Area Colors and Task Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Give every production area a fixed color, shown on cards, the Production Board, the docket detail and a legend.
- Show each docket's current area on the Main Dashboard.
- Add Task Cards: one-person sticky notes with Done, a My Cards filter and "Sent by me".

**Architecture:**
- Area colors are CSS tokens plus one `AreaChip` component, keyed by role id from `src/shared/cards.ts`.
- The docket list endpoint gains `areas`/`productionDone`, computed from the `cards` table.
- Task Cards are a new D1 table with their own routes (`src/worker/routes/taskCards.ts`). They join My Cards on the web side and extend the existing summary poll.

**Tech Stack:** Existing (Workers + Hono + D1, React + TanStack Query + Tailwind v4, Vitest 4). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-10-area-colors-and-task-cards-design.md`

## Global Constraints

- All UI text is English and uses the spec's exact strings: `Areas`, `New Task Card`, `To`, `Note`, `When`, `Rush`, `Today`, `Date`, `Send`, `Task`, `From <name>`, `Done`, `All`, `Docket cards`, `Task cards`, `Sent by me`, `Open`, `Done ✓ · <name> · <date time>`, `Delete`.
- Red (brand) and yellow are never area colors. Task cards use a light-yellow background token `--task-bg`.
- Each area token has a light variant and a dark-mode value. Chip text meets AA contrast.
- Task notes run 1–1000 characters. A person cannot send a task to themselves. Recipients must be active users.
- Task cards live in D1 only and are never written to the Google Sheet.
- Free plan: no new polling. Summary polling (20 s) now runs for every signed-in user, because anyone can receive tasks. The dashboard keeps its existing 30 s refetch.
- Touch targets are at least 44px. There is no horizontal page scroll at 375px wide (the legend scrolls inside its own block).

## Review Focus

1. **A recipient is deactivated while tasks are open.** Their tasks stay in the sender's "Sent by me" as `Open`, and the sender can still delete them (test in Task 3).
2. **Two clicks on Done, or Done on a deleted task.** The second gets 409 or 404, never a double update (test in Task 3).
3. **A docket with two jobs in the same area.** Its tile shows that area's chip once (test in Task 2).
4. **A person with no production roles receives a task.** Their badge and chime still work, because polling is no longer gated on roles (test in Task 4).
5. **`Today` tasks on later days.** They stay in `Rush / Today` (overdue), not `No Due Date` (test in Task 3).

---

### Task 1: Area colors

**Files:**
- Modify: `src/web/index.css`, `src/shared/cards.ts`, `src/web/cards/CardTile.tsx`, `src/web/cards/CardView.tsx`, `src/web/pages/ProductionBoard.tsx`, `src/web/components/DocketHistory.tsx`
- Create: `src/web/components/AreaChip.tsx`
- Test: `test/shared/cards.test.ts`, `test/web/areaColors.test.tsx`

**Interfaces:**
- Produces:
  - `AREA_TOKEN: Record<string, string>` in `src/shared/cards.ts`, mapping role id → CSS token name:
    - designer → `area-design`
    - printer_roll → `area-print-roll`
    - printer_fb → `area-print-fb`
    - laminate_roll → `area-laminate`
    - contour_cut → `area-contour-cut`
    - liquid_lam → `area-liquid-lam`
    - colex → `area-colex`
    - finishing → `area-finishing`
    - installer → `area-install`
  - CSS: `--area-*` (solid) and `--area-*-soft` (light background) in `:root` and dark mode.
    - Hues: violet `#7C3AED`, blue `#2563EB`, cyan `#0891B2`, teal `#0F766E`, green `#16A34A`, amber `#B45309`, orange `#EA580C`, pink `#DB2777`, brown `#8B5E3C`, in that order.
  - `AreaChip({ roleId, size?: "sm" | "md" }): JSX`: a rounded label with the `AREA_LABEL` text, `--area-*-soft` background and `--area-*` text color. It carries `data-area={roleId}`.
  - `AreaLegend(): JSX`: titled `Areas`, with one `AreaChip` per `ROLE_ORDER` entry.

- [ ] **Step 1: Write the failing tests.**
  - Shared: every `ROLE_ORDER` id has an `AREA_TOKEN`, and the tokens are unique.
  - Web: `render(<AreaLegend />)` shows heading `Areas` and 9 chips in order, with `Design` first and `Install` last.
  - A `CardTile` for a laminate card has a chip `Laminate` with `data-area="laminate_roll"`, and its button style sets `border-left-color: var(--area-laminate)`.
- [ ] **Step 2:** Run `npx vitest run test/shared/cards.test.ts test/web/areaColors.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement the tokens, `AreaChip` and `AreaLegend`.**
  - In `CardTile`, replace the plain area label with `AreaChip` and add `border-l-4` with an inline `borderLeftColor`.
  - In `CardView`, the header chip becomes `AreaChip`.
  - In `ProductionBoard`, each column heading gets a 10px dot in its area color.
  - In `DocketProduction`, each step label becomes `AreaChip`.
- [ ] **Step 4:** Run `npx vitest run`. Expected: all PASS.
- [ ] **Step 5:** Commit `feat: area colors on cards, board and legend`.

### Task 2: Current area on the Main Dashboard

**Files:**
- Modify: `src/worker/db/dockets.ts`, `src/shared/types.ts`, `src/web/components/DocketList.tsx`, `src/web/pages/Dashboard.tsx`
- Test: `test/worker/vendorPickup.test.ts` (rename the describe to "dashboard production fields"), `test/web/dashboard.test.tsx`

**Interfaces:**
- Consumes: `AreaChip`, `AreaLegend` (Task 1).
- Produces: `DocketSummary.areas?: string[]` and `DocketSummary.productionDone?: boolean`, set by `listDockets` only.
  - SQL `areas`: `(SELECT group_concat(DISTINCT role_id) FROM cards c WHERE c.work_order = dockets.work_order AND c.status = 'active')`. Split it and sort by `ROLE_ORDER` in `toSummary`.
  - SQL `productionDone`: `EXISTS(cards for wo) AND NOT EXISTS(cards for wo with status != 'done')`.

- [ ] **Step 1: Write the failing tests.**
  - Worker: a docket with two jobs, both with an active `printer_roll` card plus an active `colex` card, returns `areas: ["printer_roll", "colex"]`.
  - Worker: a docket whose only card is `done` returns `productionDone: true, areas: []`.
  - Worker: a docket without cards returns `areas: []`.
  - Web: a dashboard item with `areas: ["laminate_roll"]` shows a `Laminate` chip. One with `productionDone: true` shows `Done`.
  - Web: the page shows the `Areas` legend.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The tile shows its chips under the customer line.
  - The `Dashboard` header `actions` becomes a column: `+ New Docket` (existing), then the `New Task Card` slot (filled in Task 4), then `AreaLegend`. Below `md`, it moves under the filters.
- [ ] **Step 4:** Run `npx vitest run`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: current area chips and area legend on the Main Dashboard`.

### Task 3: Task cards API

**Files:**
- Create: `migrations/0007_task_cards.sql`, `src/worker/routes/taskCards.ts`, `src/shared/taskCards.ts`
- Modify: `src/worker/index.ts` (mount), `src/worker/cards/read.ts` (`myCardsSummary`), `src/shared/types.ts`
- Test: `test/worker/taskCards.test.ts`, `test/shared/taskCards.test.ts`

**Interfaces:**
- Produces:
  - Table `task_cards`, as in spec §5. `status` has `CHECK (status IN ('open','done'))` and `due_kind` has `CHECK (due_kind IN ('none','rush','today','date'))`.
  - `type TaskDue = { kind: "none" | "rush" | "today" | "date"; date?: string }`.
  - `taskBucket(due: { kind; date: string | null }, createdAt: string, todayIso: string): TimeBucket` in `src/shared/taskCards.ts`:
    - rush → `rush_today`.
    - today → `rush_today`.
    - date → `deriveTimeBucket(date, false, todayIso).bucket`.
    - none → `no_due_date`.
  - `TaskCardDTO = { id: number; from: { id: number; name: string }; to: { id: number; name: string }; note: string; due: TaskDue; bucket: TimeBucket; status: "open" | "done"; createdAt: string; doneAt: string | null; isNew: boolean }`.
    - `isNew` means: inbox and `seen_at` NULL, or sent and done and `done_seen_at` NULL.
  - `MyCardsSummary` gains `newTasks: number` and `doneTasks: number`. `newCount` = docket new cards + `newTasks`.
  - Routes as in spec §6, mounted under `requireAuth`. Errors:
    - 400 `Write a note (up to 1000 characters).`
    - 400 `You can't send a task to yourself.`
    - 400 `Choose someone to send it to.` (missing or inactive recipient).
    - 400 `Choose a valid date.`
    - 403 `This task is not yours.`
    - 404 `Task not found`.
    - 409 `This task is already done.`
    - 409 `Only open tasks can be deleted.`

- [ ] **Step 1: Write the failing tests.**
  - Shared: `taskBucket` for each kind. `today` created yesterday, checked today, gives `rush_today`. A date next month gives `coming`.
  - Worker:
    - Ana sends to Erin; Erin's `box=inbox` has it with `isNew: true` and `from.name`; Ana's `box=sent` has it `open`.
    - Validation errors, each with its exact text.
    - Erin `seen` → `isNew` false and `newTasks` 0.
    - Erin `done` → it leaves her inbox. Ana's summary `doneTasks: 1` and `newCount` excludes it. Ana `sent/seen` → `doneTasks: 0`.
    - A second `done` → 409. Ana trying `done` → 403. Erin trying `DELETE` → 403. Ana `DELETE` after done → 409. Ana `DELETE` while open → 200, and it is gone from both boxes.
    - Erin deactivated: Ana's sent still lists the task `open`, and Ana can delete it.
    - Sent excludes done tasks older than 30 days (set `done_at` back in SQL).
- [ ] **Step 2:** Run `npx vitest run test/worker/taskCards.test.ts test/shared/taskCards.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Done and seen updates use `WHERE id = ? AND status = 'open'` and check `meta.changes`.
- [ ] **Step 4:** Run `npx vitest run`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: task cards API`.

### Task 4: Task cards in the app

**Files:**
- Create: `src/web/tasks/NewTaskCard.tsx` (button + modal), `src/web/tasks/TaskTile.tsx`, `src/web/tasks/TaskView.tsx`, `src/web/tasks/SentList.tsx`
- Modify: `src/web/pages/MyCards.tsx`, `src/web/pages/Dashboard.tsx`, `src/web/cards/useCardAlerts.ts`, `src/web/components/Layout.tsx`, `src/web/index.css` (`--task-bg`, `--task-border`)
- Test: `test/web/taskCards.test.tsx`, `test/web/myCards.test.tsx`

**Interfaces:**
- Consumes: Task 3 routes and DTOs; `groupCards` / `CARD_GRID` from `MyCards.tsx`.
- Produces:
  - `NewTaskCardButton()`: the button `New Task Card`. It opens a modal titled `New Task Card`:
    - `To`: search input plus listbox of `/api/assignees`, minus the current user.
    - `Note`: textarea.
    - `When`: radio `Rush` / `Today` / `Date` (shows a date input) / none.
    - `Send`: disabled until a recipient is chosen and the note is not empty. After sending, it closes, shows the toast text `Task sent to <first name>`, and invalidates `["tasks"]`.
  - `/api/assignees` is open to everyone signed in, for the picker. **Decision:** relax its `requireLevel` (it returns only id, name and roles) and keep its tests.
  - `TaskTile({ task, onOpen })`: square tile with `--task-bg`, the `Task` label, `From <first name>`, a 3-line note clamp, a bucket tag and `NEW`.
  - `TaskView({ task, onClose })`: modal with the full note, `From <name> · <date time>` and the `Done` button. It calls `seen` on open.
  - My Cards:
    - Filter tablist `All` · `Docket cards` · `Task cards` · `Sent by me`, above the role tabs. Role tabs show only when the filter is `All` or `Docket cards`.
    - Tasks merge into the same time groups; inside a group, tasks come first.
    - `Sent by me` renders `SentList` (rows with recipient, note, status, `Delete` while open) and calls `sent/seen` on show.
    - The header shows `NewTaskCardButton`.
  - `useCardAlerts`:
    - Enabled for every signed-in user. **Decision:** this supersedes the roles gate added in the production-cards review.
    - Badge count = `newCount + doneTasks`. The chime still fires only when `newCount` rises.
    - The title uses `newCount + doneTasks`.

- [ ] **Step 1: Write the failing tests.**
  - The modal: `Send` is disabled until both are set. It posts `{toUserId: 5, note: "Call the vendor", due: {kind: "today"}}`.
  - My Cards with one task and one docket card:
    - `All` shows both.
    - `Task cards` shows only the yellow `Task` tile.
    - `Docket cards` shows only the docket card.
  - Opening a task posts `seen`. `Done` posts `done` and the tile disappears.
  - `Sent by me` lists `Done ✓ · Erin · Nov 10, 3:40 PM` and an open task with `Delete`. Delete asks `confirm` and posts `DELETE`.
  - Alerts: summary `{newCount: 0, doneTasks: 1}` → badge `1`, no chime. Then `{newCount: 1, doneTasks: 1}` → badge `2` and one chime.
  - A user with `roles: []` still polls the summary. This replaces the earlier "does not poll" test.
  - The dashboard shows the `New Task Card` button for managers.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: task cards in My Cards, Sent by me and the dashboard`.

### Task 5: Check and publish

- [ ] **Step 1:** Run `npx vitest run`, `npm run typecheck` and `npm run build`. Expected: all green.
- [ ] **Step 2: Local preview** (seed with `wrangler d1 execute --local`, as done for production cards):
  - The legend, chips and card borders are visible in light and dark.
  - A task is sent between two local users, then marked Done.
  - At 375px wide there is no horizontal page scroll.
- [ ] **Step 3:** Run a final whole-branch review and one fix pass. Merge to main, publish with `scripts/publish.ps1` (migration 0007) and push, each step when the user approves it.
