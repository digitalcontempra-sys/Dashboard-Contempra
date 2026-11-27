# Dashboard Contempra: guide for Claude Code

Read this whole file before doing anything. It is the project's memory: what it is, how it is built, how changes are made, tested, published and pushed, and what is still pending. Keep it up to date when something here changes.

---

## 1. Ground rules (non-negotiable)

1. **Language.**
   - **Talk to the owner in Spanish, always.** Every chat reply is in Spanish, even when tools return English.
   - **Everything that ships in the project is in English.** That covers UI text, labels, errors shown to users, sheet headers, code, comments, commit messages and docs like this one.
   - The owner insisted on this repeatedly. Never reply in English.
2. **The owner approves outward actions.** Ask in chat and wait for a clear yes before each of these:
   - merging to `main`;
   - publishing to Cloudflare;
   - pushing to GitHub;
   - any one-time action on the Google Sheet.

   An approval covers that one action only. The usual flow: finish the work, show the result, ask "¿Hago merge a main y publico?", then do merge + publish + push on a yes.
3. **Free plans only.** Everything runs on the free tiers of Cloudflare Workers, D1, R2 and the Google APIs. No paid features, no Durable Objects, no WebSockets. Keep polling light.
4. **Test-driven.** Write the failing test first, watch it fail, then implement, then run the whole suite. The suite must be green before any commit.
5. **Never commit or print secrets.**
   - `.dev.vars`, `.prod.vars`, `.env*` and `fixtures/local/` are git-ignored; keep them that way.
   - Never echo token, key or password values in chat.
6. **Save tokens.**
   - One conversation per topic. Start a new chat for each new change.
   - Read only what you need: grep and read line ranges, not whole files.
   - Keep replies short.

---

## 2. What this project is

A production dashboard for **Contempra Signs** (a sign shop in Winnipeg). It sits on top of the shop's Google Sheet "Workorder Books", the work-order book everyone already uses, and adds the following:

- **Main Dashboard.** Every work order (docket), in one section each: Rush / Today, Upcoming, **New Orders**, No Due Date, **Daily Complete** (spec `2026-11-24-dashboard-sections-design.md`).
  - **New Orders:** saved with **Save as New Order** (editor, only while not in production): customer + a note in the description, nobody in Send to. Flag `virtual_dockets.new_order`; sheet K = creator, STATUS `Waiting for more info`. Its tile opens the editor. It leaves New Orders when it is handed to people.
  - **Daily Complete:** the creator's card is `Ready to close` with nobody else on the docket (done, waiting for delivery). `Close docket` (= delivered) moves it to History.
  - Order: All by creation date (newest first); Rush and Upcoming by Due Date (soonest first); New Orders and No Due Date newest first; Daily Complete longest waiting first. Coming no longer exists anywhere (`TimeBucket` = `rush_today | upcoming | no_due_date`).
  - **All dockets | My Dockets** (selector above the views, remembered per user in `localStorage` `dashboard.scope.<id>`): My Dockets = dockets whose J (Account Manager) is one of my codes (`GET /api/dockets?mine=1`). Same sections, orders and counts. Without codes: "Ask an admin to set your initials." Spec `2026-11-26-my-dockets-design.md`.
  - **My List** (third scope, `GET /api/dockets?list=1`): dockets I follow (table `docket_follows`). Bookmark button on each tile and in the docket header (`PUT`/`DELETE /api/dockets/:wo/follow`, one tap, `Add to My List` / `Remove from My List`). Personal, no alerts, no sheet writes; a closed docket stays and shows in History. List and detail carry `followed` + `myOpenNotes` for the viewer. Spec `2026-11-26-my-list-and-notes-design.md`.
  - **Docket notes:** the note button on a tile / docket header opens New Task Card as a note to self pinned to the docket (`task_cards.work_order`; server: self only, admin/manager only, docket must exist). Yellow mark with the count on the tile; the detail lists my open notes with Done (`GET /api/task-cards?workOrder=`). My Cards shows `#WO`; the opened note has `Docket #WO`. Staff have neither (no Main Dashboard).
  - **Header** (spec `2026-11-27-dashboard-header-design.md`): Winnipeg clock, three personal cards (Overdue task cards → `/my-cards?show=task`; At risk and Waiting on you → `?focus=risk|waiting`, a personal filter that replaces the scope, with a dismissible chip) and **Areas · Open board** (open cards per area → `/production?area=<roleId>`, which scrolls to and flashes that column). Data: `GET /api/dashboard/summary` (30 s, with the list); rules in `src/worker/dashboard/rules.ts`, shared by the summary and `/api/dockets?focus=`. Grid `.dash-head` in `index.css`: 5 blocks from 1680 px, areas under the cards below that, collapsible areas on phones.
  - Each tile (and the docket header, "Now with") shows who has it now, per area. It also has On Hold and History views, an account-manager filter and search. The docket detail links to the editor with **Edit Docket** (pencil icon) and offers **Download PDF**; it has no Drive button (the Drive copy stays as a backup).
- **Virtual Docket.** A replica of the paper docket form that writes the docket's row to the sheet, renders a PDF in the browser and stores it in R2 and Google Drive. Dockets can be cancelled, moved to Trash and restored.
- **Production cards (hand to hand, like the paper docket).** The creator sends the new docket to one or more people, each with a `What to do` note. Each card belongs to one person, in one area (or `General` for people without one), with:
  - required fields (★);
  - `I'm on it`, `Continue →` (to one or more people, each with `What to do`), `Done` (back to the creator), `← Send back` (with a reason, to whoever handed it over);
  - `Proof sent` (Designer) / `Sample sent` (Printer Roll, Printer FB, Laminate Roll, Liquid Lam): back to the creator, waiting for the client;
  - on the creator's card: `Close docket` (when `Ready to close`) or `Approved → Continue`;
  - Admin `Restore` (Production tab of a docket);
  - a full history.
  - **Read Docket** (button in the card header): a read-only panel with the docket grouped (Customer, Dates, Work, Address & service, Order, Notes from the sheet; no Link: the dashboard shows no Drive links, column P keeps it in the sheet) and **View PDF**. It never shows prices; Staff get a fresh price-free PDF. Spec `2026-11-24-read-docket-design.md`.
- **Production Board** (managers): one column per area, plus `General`.
- **Notifications.** A chime, a pulsing badge and the tab title. On iPhone, sound needs a tap first, so the app shows "Tap anywhere to turn on sound".
- **Task Cards.** Yellow sticky notes from one person to another, with Done. My Cards has the filter All / Docket cards / Task cards / Sent by me / History.
  - A person can write a **note to self** ("Me" first in the To list). It is seen from the start and sets `done_seen_at` on Done, so it raises no badge, chime or done alert. It is left out of Sent by me.
  - **History** lists every finished Task Card I sent or received (labels `Sent by me`, `Sent by <name>`, `Note to self`), newest `done_at` first, 50 per page with Show more (`GET /api/task-cards?box=history&page=N`).
- **Installer photos.** Taken with the phone camera, resized in the browser, uploaded to one Drive folder per docket. Thumbnails are kept in R2.
- **Area colors** with a legend, current-area chips on the Main Dashboard, and white cards even in dark mode.
- **User codes (Initials)** = the codes people type in sheet column J (table `user_codes`, one owner per code, the first is the main one; Admin → Users → Initials). A docket created in the portal gets SALESPERSON (J) = the creator's main code (read-only; 400 `Ask an admin to set your initials first.` without one). Editing never changes SALESPERSON.
- **Staff accounts** with three access levels:
  - Admin: everything, including users.
  - Manager: all work orders and billing.
  - Staff: only their own cards.
- **Production roles:** Designer, Printer Roll, Printer FB, Laminate Roll, Contour Cut, Liquid Lam, Colex, Finishing / Packaging, Installer, Measure (site measurements; fields like Installer, photos too), Sub Contract (work sent out: Subcontractor ★, Work sent ★, Sent out, Expected back, Received back ★, Notes).
  - **Sub Contract:** all admins and managers have it; only an admin or manager can send work to it (server 403, hidden in Send to for Staff). It is not anyone's "own" area: a manager who only has it still gets a General card by default (`homeAreas`).
- **Installer teams** (Team A, Team B…): Admin → Teams (`/api/teams`, tables `teams` + `team_members`). Send to → a team gives **one** Installer card to all members (`cards.team_id`, members copied into `assignee_ids`); the first to press `I'm on it` takes it and the other members get 409 `<name> is already on it.` on any move. Sheet K / Assigned / Install cell and Docket Tracking show the team name until someone starts it. Spec `2026-11-24-subcontract-and-teams-design.md`.

---

## 3. Where things are

| What | Where |
|---|---|
| Project folder (Windows) | `C:\Users\meinrad\Documents\GitHub\Dashboard Contempra` |
| Same folder in Git Bash | `/c/Users/meinrad/Documents/GitHub/Dashboard Contempra` |
| GitHub repo | `https://github.com/digitalcontempra-sys/Dashboard-Contempra` (branch `main`, git user `digitalcontempra-sys`) |
| Live app | `https://dashboard-contempra.digitalcontempra.workers.dev` |
| Cloudflare Worker | `dashboard-contempra` (account of `digitalcontempra@gmail.com`) |
| D1 database | `dashboard-contempra`, id `fecb7963-b1d0-4519-8760-75b3bd214e91` |
| R2 bucket | `contempra-dockets` (binding `DOCKETS_BUCKET`): docket PDFs `dockets/<WO>.pdf`, photo thumbnails `photo-thumbs/<id>.jpg` |
| Google account (sheet owner) | `digitalcontempra@gmail.com`, connected through OAuth in Admin → Google connection |
| Google Cloud project | "Contempra Dashboard" (`contempra-dashboard`), OAuth app "In production" (unverified) |
| Connected sheet **today** | **Workorder Books TEST**, id `11hwLecfxLJsnxqYddXubic6x8baThKgcDY1SBEFtrtM` (testing phase) |
| Drive layout | `Contempra Dockets/<year>/<WO> - <FOR>.pdf` and `Contempra Dockets/<year>/<WO> - <FOR> Photos/` |
| Specs (design docs, in Spanish) | `docs/superpowers/specs/` |
| Implementation plans | `docs/superpowers/plans/` |

---

## 4. Stack and architecture

- **One Cloudflare Worker** serves both the API and the web app:
  - Hono API under `/api/*`, entry `src/worker/index.ts`.
  - React SPA through Workers Static Assets (`run_worker_first: ["/api/*"]`, SPA fallback).
- **Web:** React 18, React Router 6, TanStack Query 5, Tailwind v4, built with Vite (`@cloudflare/vite-plugin`).
  - Design: "light glass", Apple-style, square tiles. Brand red is `#CC1428`.
  - Tokens live in `src/web/index.css`: primitives → semantic → component.
  - Custom utilities use `@utility`, not `@apply` of custom classes.
- **Data:** D1 (SQLite) holds the app's own data plus a mirror of the sheet (`dockets` table).
  - The Google Sheet stays the shop's source of truth for columns A–P, except K (ROLE), which the dashboard writes for dockets with cards.
  - Columns Q–AD are written only by the dashboard.
- **Google:** OAuth with the sheet owner's Gmail.
  - Scopes: `openid email spreadsheets drive.file`.
  - The refresh token is AES-GCM encrypted with the `TOKEN_KEY` secret.
  - Gateways: `src/worker/google/{sheets,drive,oauth,gateways}.ts`. Tests swap in fakes with `__setTestGateways`.
- **Crons** (`wrangler.jsonc`):
  - `*/5 * * * *`: incremental sheet sync, then retries for Drive PDF copies, then retries for card → sheet writes.
  - `0 8 * * *` (3 AM Winnipeg): nightly reconcile and Trash purge.
- **PDF:** rendered in the browser with `@react-pdf/renderer` (lazy chunk) and uploaded with `PUT /api/virtual-dockets/:wo/pdf`. The Drive copy happens in the background, with retries.

### Directory map

```
src/shared/            pure rules shared by worker + web
  rules.ts             status, billing, time buckets, Winnipeg dates
  docketForm.ts        docket form model, totals, sheet cell mapping, money format
  cards.ts             roles, areas, colors, card fields per role, Continue blockers, normalizeJob, sheet cell text
  taskCards.ts         task card due → time bucket
  staffRoster.ts       approved staff list for the Admin "Import staff" tool
  types.ts             DTOs
src/worker/
  index.ts             routes mount order + cron handler
  routes/              auth, users, staffImport, dockets, virtualDockets, cards, cardPhotos, taskCards, google, sync
  cards/               service (reconcile route → cards), actions (claim/fields/continue/send back), read (My Cards, Board, history), dto, sheetSync (Q–AD + Production tab + queue)
  dockets/             service (create/edit/cancel/trash), pdf, lock (D1 lease), errors
  google/              oauth, sheets gateway, drive gateway
  sheet/               raw sheet reading + row mapping (A–P)
  sync/                incremental + nightly sync
  users/codes.ts       user codes (sheet J initials): normalize, check owner, replace
src/web/
  pages/               Dashboard, MyCards, ProductionBoard, DocketEditor, AdminUsers, ImportStaff, ProductionColumns, ChangePassword, NonBilled, NeedsReview, Trash, Login, GoogleConnection
  cards/               CardTile, CardView, fields, PhotoField, resizePhoto, chime, useCardAlerts
  tasks/               NewTaskCard, TaskCards (tile, view, Sent by me)
  components/          Layout (nav, badge, sound toggle), DocketList, DocketDetail (tabs), DocketHistory, AreaChip/AreaLegend, BucketChip
  docket/              DocketPaper (paper replica), ProductionPanel (route editor), DocketPdf, afterSave
migrations/            0001–0015 (D1). Add new ones as 0016_*.sql; never edit an applied one
data/catalogs/         material lists: roll-print, flatbed (Print FB), laminate (Laminate Roll)
scripts/               publish.ps1, set-google-secrets.ps1, dev-setup.mjs, create-admin.mjs, import-fixture.mjs, xlsx_to_values.py
test/                  shared/ (pure), worker/ (vitest-pool-workers + fakes), web/ (jsdom + mockApi)
```

---

## 5. Key domain rules (do not break)

- **Sheet columns A–P (tab `Contempra`):** Date, Due Date, Work Order, COMP, HOLD, #, Customer, Project, Address, Account Manager, ROLE, Inv, Inv/Date, Quote/PO/Deposit, Notes, LINK.
  - Rows are always located by Work Order (column C), never by a cached row number.
  - Every app write to the sheet runs inside `withLock(db, "sheet")`. The row is re-read before writing.
- **Columns Q–AD** (written only by the dashboard). Layout version `v7` (v6 added Measure, v7 Sub Contract), stored in `app_settings.production_columns`:

  | Q | R | S | T | U | V | W | X | Y | Z | AA | AB | AC | AD |
  |---|---|---|---|---|---|---|---|---|---|---|---|---|
  | Stage | Design | Print Roll | Print FB | Laminate | Contour Cut | Liquid Lam | Colex | Finishing | Install | Measure | Sub Contract | Assigned | Photos |

  - AD holds `=HYPERLINK(folder,"Photos (n)")`, written with USER_ENTERED.
  - **If you change this layout:** bump `PRODUCTION_COLUMNS_VERSION` in `src/worker/cards/sheetSync.ts` and keep the in-place upgrade path. After publishing, the owner must press **Admin → Set up production columns** again; until then, sheet writes stay queued.
  - The first setup copies the old Q–Y to the tab `Legacy Q-Y`.
- **STATUS column (v5).** Set up inserts a real column **L = STATUS** after ROLE; Inv…LINK move to M–Q and Stage…Photos to R–AE. The code still uses the original letters (A–P, Q–AD): `src/worker/sheet/layout.ts` translates them when the connected sheet has the column (`app_settings.status_column` = that sheet's id). `getGateways(env).sheet` and the sync reader (`readContempra`) translate; `getRawGateways` does not (only for inserting the column). The logical cell key `STATUS` writes L. Never hard-code the shifted letters.
- **Column K (ROLE) + STATUS** show who has the docket now and in what state, in the same order: per active card, whoever pressed `I'm on it` (`In progress`), else its assignees, else its area label (`Starting`, or `Returned` after a send back). The creator's card shows `Ready to close`, `Waiting for design approval` or `Waiting for sample approval`. All cards done (closed) → K is whoever closed it, STATUS `Done`. A docket without cards keeps its K. Staff no longer type in K.
- **`Production` tab:** one row per card (Work Order, Job, Step, Role, Assigned To, Status, Fields, Returned Reason, Updated By, Updated At).
- **`Docket Tracking` tab** (from `v4`): one row per docket (Work Order, Customer, Tracking). Tracking is one cell, one line per event, Winnipeg time, e.g. `Ira - received from Mike - November 23 2026 - 9:37 AM`. Lines: `created` (from `virtual_dockets`), `received from <name>` (`activated`), `started` (`claimed`), `sent to <name> (<what to do>)` (`continued`), `returned to <name> (<reason>)` (`sent_back`), `done, back to <creator>`, `proof sent, back to …`, `sample sent, back to …`, `approved`, `closed`, `restored`. Old-route events keep their old text (`received`, `sent to <area>`, `done`). `Legacy Q-Y` is never touched again.
- **Card → sheet writes go through a queue (`card_sheet_queue`).** D1 commits first. Then `flushCardSheet` runs in `waitUntil`, and the cron retries failures. Google being down never blocks production.
- **Hand-off rules** (`src/worker/cards/handoff.ts`, pure rules in `src/shared/handoff.ts`, spec `2026-11-23-docket-handoff-flow-design.md`):
  - Hand-off cards have `handoff = 1`, one person in `assignee_ids`, `from_user_id` / `from_card_id` (who handed it over) and `instruction`. New cards use `job_sort = 0`, `step = max + 1`.
  - One **creator card** per docket (`stage` not null, role `general`, assigned to `virtual_dockets.created_by`): Done / Proof sent / Sample sent reactivate it. `ready_to_close` never hides a waiting approval.
  - Send back parks my card (`waiting`) and reopens the `from_card`; a later Continue to the same person + area reuses the parked card (fields kept).
  - Close docket: only on `ready_to_close`, only when no other card is active; sets COMP. Restore (Admin) reopens a done card; on a closed docket it clears COMP (`queue comp: 0`).
  - A card naming people is theirs whatever their areas (`canAct`, `visibleTo`); a team card (`[]`, old routes) is for the area's people.
  - Every move bumps the card's `version`. A second concurrent move gets 409 `This card was already moved by <name>.`
  - **Old routes:** the API still accepts `jobs` (route cards, `handoff = 0`), only for old data and tests; the app sends `handoff` instead. Editing a docket without `jobs` leaves its cards alone. Old `waiting` route cards are dropped at the first hand-off move.
- **Continue blockers** live in `src/shared/cards.ts` (`continueBlocker`). The server enforces them on Continue and Done (not on Proof/Sample sent, not on the creator's card); the UI shows the same message.
- **Docket completion:** only `Close docket` sets COMP (column D). Designer `On hold` sets HOLD (column E).
- **Field saves** are debounced 1 s in the UI. They reach the sheet on the 5-minute cron; moves (claim, continue, send back) write at once.
- **Dates:** always calendar inputs (`type="date"`, stored as YYYY-MM-DD). The server rejects free-text dates.
- **Passwords:** PBKDF2-SHA256 hashes in D1 `users.password_hash`. Nobody can read them.
  - Imported or reset accounts have `must_change_password = 1`. Until it is cleared, every API call except `/api/auth/me`, `/api/auth/change-password` and `/api/auth/logout` returns 403.
- **Prices never reach Staff** (form costs, totals, the PDF with prices).

---

## 6. Workflow for any change

1. **Small fix** (a copy tweak, one component):
   1. Confirm the behavior with the owner in one or two lines (Spanish).
   2. Write the test first, implement, run the whole suite.
   3. Commit, then ask to publish.
2. **New feature:**
   1. Ask the owner focused questions one at a time.
   2. Write a short spec in `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` (Spanish; UI strings in English) and get the owner's approval.
   3. Write the plan in `docs/superpowers/plans/`.
   4. Implement on a branch `feature/<name>` with TDD, committing as you go.
   5. Have a fresh reviewer check the whole branch, and fix what it finds that matters.
   6. Ask "¿Hago merge a main y publico?"
3. **Verification before saying "done":**
   - `npx vitest run` passes (today 593 tests).
   - `npm run typecheck` is clean.
   - For UI changes, check the page in the local preview, including phone width 375 px: no horizontal scroll.
4. **Commit messages:**
   - English, conventional style (`feat: …`, `fix: …`, `docs: …`, `chore: …`).
   - End every commit message with:

     ```
     Co-Authored-By: Claude <noreply@anthropic.com>
     ```

---

## 7. Commands

Run these from the project folder. In Git Bash: `cd "/c/Users/meinrad/Documents/GitHub/Dashboard Contempra"`.

```bash
npm install                 # once, or after dependency changes
npx vitest run              # whole test suite (worker + web + shared projects)
npx vitest run test/web/myCards.test.tsx   # one file
npm run typecheck           # tsc for worker + web
npm run build               # typecheck + vite build
npm run dev                 # local dev server (Vite + local Worker + local D1), http://localhost:5173
```

**Local development notes:**
- `.dev.vars` (git-ignored) holds local secrets: `SETUP_TOKEN`, `DEV_ADMIN_USER`, `DEV_ADMIN_PASSWORD`, `TOKEN_KEY`.
- Apply migrations to the local DB with `npx wrangler d1 migrations apply dashboard-contempra --local`.
- Google is **not** connected locally, so anything that writes to the sheet or Drive fails locally. Saving a docket and uploading a photo only work online. To check card UI locally, seed rows with `npx wrangler d1 execute dashboard-contempra --local --file <sql>`.
- If a new API route returns 404 locally, restart the dev server: the Worker does not always hot-reload new route files.

---

## 8. Publishing (Cloudflare): exact flow

**Only after the owner says yes.** Always from `main`, with the suite green.

```powershell
powershell -ExecutionPolicy Bypass -File scripts/publish.ps1
```

What `scripts/publish.ps1` does:
1. **TOKEN_KEY.** Uploads it only the first time. The backup is in the git-ignored `.prod.vars`. Never regenerate it: that breaks the stored Google token. `-ResendKey` re-uploads the saved one.
2. **Migrations.** Applies pending D1 migrations to production (`wrangler d1 migrations apply dashboard-contempra --remote`).
3. **Deploy.** Runs `npm run build` + `wrangler deploy`.

Each network step is retried 3 times.

**Known issues and fixes:**
- **"fetch failed" / ETIMEDOUT / "auth token has expired and could not be refreshed".**
  - On slow connections, Node gives up on each connection attempt after 250 ms. The script already sets `NODE_OPTIONS=--dns-result-order=ipv4first --network-family-autoselection-attempt-timeout=3000`. If you run wrangler by hand, set the same variable.
  - When Claude Code runs the script, it may need to run **outside the sandbox**, because the sandbox can block Node's network.
  - If wrangler says you are not logged in, run `npx wrangler login` (the owner signs in in the browser), then publish again.
- **Output noise.** PowerShell prints `NativeCommandError` lines for wrangler's stderr. They are harmless. Look for `Done: https://dashboard-contempra…` and `exit 0`.
- **Check after publishing:** `GET /api/health` returns 200. New routes return 401 (not 404) without a session.

After a publish that changed the sheet layout (Q–AD), remind the owner to press **Admin → Set up production columns**.

---

## 9. Pushing to GitHub: exact flow

**Only after the owner says yes** (usually together with "merge y publica").

```bash
git checkout main
git merge --no-edit feature/<name>     # if work was on a branch
npx vitest run                          # must be green on main
git branch -d feature/<name>
git push origin main
```

- Credentials are already stored on this PC. If a push asks for them, stop and ask the owner; never guess.
- Never force-push. Never rewrite published history.
- `CRLF will be replaced by LF` warnings are normal on Windows.

**Usual order after a yes:** merge → tests on main → publish → push → tell the owner what to check (in Spanish).

---

## 10. Testing tips (learned the hard way)

- **Worker tests** (`test/worker/`) run in the Workers runtime (`@cloudflare/vitest-plugin`) with migrations applied, and use the Google fakes in `test/worker/fakeGoogle.ts`.
  - Helpers: `test/worker/helpers.ts` (`createUser`, `login`, `api`) and `test/worker/cardHelpers.ts` (`setupCards`, `newDocket`, `route`, `step`, `cardsOf`).
- **Requests to `SELF` can start `waitUntil` work that races with the test.** For sheet-flush tests, create the docket before marking the columns ready, or call `flushCardSheet` directly.
- **Web tests** (`test/web/`) use jsdom.
  - `mockApi` stubs `fetch`. Unmocked routes return 404, except `/api/auth/me`, which returns 401.
  - Mock `src/web/cards/chime` and `src/web/cards/resizePhoto` (no audio or canvas in jsdom).
- **Bash heredocs** with large inline Python or TS sometimes fail to parse in this environment. Write a script file in the scratchpad and run it instead, or use the Edit and Write tools.

---

## 11. Gotchas (UI)

- **iPhone Safari:**
  - Date inputs and fieldsets keep a min-content width. Global CSS sets `min-width: 0`, and the card bodies use `overflow-x-hidden`. Keep it that way: no card may scroll sideways.
  - Web Audio needs a tap. `chime.ts` unlocks on tap and sets `navigator.audioSession.type = "playback"` so sound plays even in silent mode. The chime cannot play with the phone locked or the app closed; that would need push notifications, which do not exist yet.
- **Cards stay white in dark mode.** They carry the `.force-light` class, which reapplies the light tokens.
- **Area chip text uses per-area `--area-*-ink` tokens.** A test enforces AA contrast in both themes.
- **Modals keep `onClose` in a ref.** A parent refresh (the dashboard refetches every 30 s, the alerts poll every 20 s) must not steal focus or repeat side effects.
- **Polling:** the alerts poll (`/api/my-cards/summary`) runs every 20 s for every signed-in user (anyone can receive Task Cards), every 60 s in a hidden tab. The dashboard list and header refetch every 30 s (History every 5 min) and pause in a hidden tab (TanStack default).
- **D1 rows read (free plan: 5M/day).** Spec `2026-11-27-d1-rows-read-design.md`. D1 counts every index entry, table row and temp-table (sort, GROUP BY) row visited. Rules:
  - Polled routes go through `cachedJson` (`src/worker/http/etag.ts`): ETag from `data_version` (bumped by triggers, migration 0015) → 304 while nothing changed. A new table a polled view reads needs the same three triggers; a new card column a tile shows goes in the `cards` UPDATE trigger's WHEN.
  - Hot-path queries must use the covering indexes (`idx_dockets_status_cover`, `_status_date`, `_am_cover`, `_wo_num`): select only their columns before the page, full rows for the page alone. `test/worker/rowsRead.test.ts` measures them on a production-sized seed and fails on `SCAN dockets`.
  - No `GROUP BY` / `IN (SELECT value FROM json_each(?))` over dockets on hot paths: use `sum(x = …)` and `json_each(?) j CROSS JOIN dockets d`.
  - The incremental sync skips unchanged work-order blocks (`sync_blocks`); account managers are cached a day in `app_settings`.

---

## 12. Status (2026-11-24)

Everything below is live and pushed to `main`:
- Main Dashboard, sync, Virtual Docket (Edit Docket, Download PDF, cancel, Trash), PDF / Drive backup;
- production cards by hand-off with all 11 areas (incl. Measure and Sub Contract), Installer teams, Read Docket, Board, history, notifications;
- sheet layout `v7`: STATUS column (L), Stage…Photos in Q–AD (logical letters), column K holder, `Production` and `Docket Tracking` tabs;
- Task Cards (notes to self, History), installer photos (AD link), area colors;
- calendar-only dates; material lists per area (Roll, Print FB, Laminate Roll);
- staff accounts (imported; the owner's account has Printer Roll, Designer and Contour Cut).

- Main Dashboard sections (New Orders, Daily Complete, Upcoming), Save as New Order, migration 0012 (live 2026-11-24; no sheet layout change).
- My Dockets + user codes (Initials), migration 0013 (live 2026-11-26; no sheet layout change). Codes `CF` and `MN` in J belong to nobody.
- Segmented controls with a solid active pill (`Segmented`, `--seg-*` tokens; live 2026-11-26).

### Pending: owner

1. **Set up production columns (v7)** on the TEST sheet, if not pressed yet since the Sub Contract publish: until then sheet writes stay queued.
2. **Still testing on the TEST sheet.** To go live with the real "Workorder Books":
   1. Admin → Google connection → paste the real sheet URL.
   2. Press **Set up production columns** on it. This copies Q–Y to `Legacy Q-Y` and writes the Q–AD headers.
   3. Confirm sync works.
3. **Security:**
   - Delete the sheet tab `USERS`. It holds plaintext passwords from an old experiment; the dashboard does not use it.
   - Rotate the Google OAuth client secret. It was once pasted in chat:
     1. Google Cloud Console → Credentials → the OAuth client → **Add secret**, and download the JSON.
     2. Run `powershell -ExecutionPolicy Bypass -File scripts/set-google-secrets.ps1`.
     3. Check **Sync now** in Admin.
     4. Disable the old secret.
4. **Laminate Roll list.** The material list is provisional; replace `data/catalogs/laminate-materials.json` when the owner sends the final one.

### Pending: technical (do only when the owner asks)

- **Push notifications** (sound with the phone locked or the app closed).
- **Deferred minors:**
  - Deleting a Task Card that was just finished fails silently.
  - "Sent by me" does not refresh while open.
  - The tab title says "New cards" for done-only alerts.
  - Overdue dated tasks show "Rush / Today" instead of "Overdue".
  - Escape discards a draft in New Task Card.
  - Rare races: route edit vs. card action, and the two-step continue / send-back writes.
  - Hand-off moves are several D1 writes after the guarded update (not one batch): a crash mid-move can leave a done card with no receiver.
  - Rare hand-off races: Close vs. a concurrent Continue on another branch; two Continues to the same person reusing one parked card; a send back onto a target card that is already active.
  - A newer `waiting_*` approval replaces an older one on the creator's card (latest wins).
  - `claimCard` silently takes over another person's claim.
  - Production-tab rows are keyed by job name.
  - Queue rows of purged dockets are never cleaned.
  - There is an import cycle `dockets/service ↔ cards/service ↔ cards/sheetSync`.
  - A cancelled New Order keeps `new_order = 1` and its sheet K / STATUS (`Waiting for more info`); History hides the section, and Inv/Date says CANCEL.
  - Daily Complete "waiting since" restarts when another branch finishes later (`activated_at` of the creator's card).
- **D1 rows read, still open:** History counts every closed docket (~11k rows) on each refresh while it is open and data changed; any data change invalidates every viewer's ETag.
- My Cards reads `?show=` only on mount (a link to it from My Cards itself would keep the old filter; no such link today).
- **Optional:** auto-deploy from GitHub through Cloudflare.

---

## 13. Starting a new chat

1. Read this file.
2. Run `git status -sb` and `git log --oneline -5` to see where things stand.
3. Ask the owner (in Spanish) what they want to change. Then follow section 6.
