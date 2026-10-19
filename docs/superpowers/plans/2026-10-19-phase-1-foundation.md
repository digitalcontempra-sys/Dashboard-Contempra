# Dashboard Contempra — Phase 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployed, mobile-first, read-only dashboard: username/password login with Admin/Manager/Staff levels, user and role admin, and a once-a-minute mirror of the `Contempra` Google Sheet tab into D1. Over that mirror it serves the Main Dashboard (Active / On Hold / History with Completed + Cancelled), time buckets, Non Billed Jobs (two tabs) and the Needs Review queue.

**Architecture:** One Cloudflare Worker serves the React SPA (Workers Static Assets) and a Hono JSON API under `/api`. A cron trigger (`* * * * *`) reads `Contempra!A1:P` through the Google Sheets API with a service account, maps rows with pure domain functions, and upserts only changed rows (row hash diff) into D1. Phase 1 never writes to the sheet.

**Tech Stack:** TypeScript 5, Vite 6, React 18, React Router 6, TanStack Query 5, Tailwind CSS 4, Hono 4, Cloudflare Workers + D1 (Wrangler 4), Vitest 3 with `@cloudflare/vitest-pool-workers`, Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-19-dashboard-contempra-design.md` (sections 1–4, 6, 7, 8 and phase 1 of section 9).

## Global Constraints

- All user-facing text is English. Labels exactly as in the spec: `Account Manager`, `Active`, `On Hold`, `History`, `Completed`, `Cancelled`, `Rush / Today`, `This Week`, `Coming`, `No Due Date`, `Overdue`, `Non Billed Jobs`, `Ready to Bill`, `Open – Not Billed`, `Needs Review`, `Main Dashboard`, `My Cards`, `Admin`.
- Phase 1 is **read-only toward Google Sheets**. No code path may call a Sheets write endpoint.
- Rows are identified by `Work Order`, never by row number.
- Business timezone: `America/Winnipeg`. Weeks run Monday–Sunday.
- Access levels: `admin`, `manager`, `staff`. Main Dashboard, Non Billed and Needs Review: admin + manager. User admin and sync controls: admin only.
- Password hash: PBKDF2-SHA256, 100000 iterations (the workerd maximum), 16-byte salt, stored as `pbkdf2$100000$<saltB64>$<hashB64>`.
- Session cookie `cd_session`: HttpOnly, Secure, SameSite=Lax, Path=/, 30 days. Only the SHA-256 of the token goes into D1.
- Requires the Cloudflare **Workers Paid** plan: the per-minute diff reads ~11.7k rows/min from D1, more than the free tier allows.
- Mobile-first: every screen must work at 375px width with no horizontal page scroll. Touch targets ≥ 44px.
- Real customer data (xlsx export, generated fixtures) never gets committed. `fixtures/local/` is gitignored.

## Review Focus

1. **Sheet columns moved or renamed** → sync aborts with `Header mismatch: <column>` in sync status and writes nothing (test in Task 6).
2. **Google API down or slow** → the last good data stays visible, and the UI shows `Last synced N min ago` with a warning past 5 minutes (tests in Tasks 6 and 11).
3. **Junk in date cells** (`Sep 23, 0202`, `in production`, serials out of range) → no crash; the date is `null` and the raw text is kept and shown (test in Task 2).
4. **Partial or empty sheet read** → if the read returns fewer than 50% of the dockets currently in D1, sync aborts without deleting anything (test in Task 6).
5. **User deactivated while logged in** → their sessions are deleted and the next request returns 401 (test in Task 8).

---

## File Structure

```
package.json, tsconfig.json, vite.config.ts, wrangler.jsonc, vitest.config.ts, .dev.vars.example
migrations/0001_init.sql            D1 schema
src/shared/types.ts                 shared DTOs (API ⇄ UI)
src/shared/rules.ts                 pure domain rules (status, billing, buckets, dates)
src/worker/index.ts                 Worker entry: fetch (Hono) + scheduled
src/worker/env.ts                   Env bindings type
src/worker/sheet/mapRows.ts         sheet rows → DocketRecord + review items
src/worker/sheet/googleClient.ts    service-account JWT + values.get
src/worker/sync/syncDockets.ts      diff + upsert + delete + sync_state
src/worker/db/dockets.ts            docket queries (list, detail, non-billed, review)
src/worker/auth/password.ts         hash/verify
src/worker/auth/sessions.ts         create/read/delete sessions, middleware
src/worker/routes/{auth,users,dockets,sync}.ts
src/web/main.tsx, src/web/App.tsx, src/web/api.ts, src/web/auth.tsx
src/web/components/{Layout,DocketList,DocketDetail,BucketChip,SyncBadge}.tsx
src/web/pages/{Login,Dashboard,NonBilled,NeedsReview,AdminUsers,MyCards}.tsx
scripts/xlsx_to_values.py           xlsx → Sheets-API-shaped JSON (local dev)
scripts/import-fixture.mjs          POSTs that JSON to /api/dev/import
test/**                             mirrors src/
```

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `wrangler.jsonc`, `vitest.config.ts`, `.dev.vars.example`, `src/worker/index.ts`, `src/worker/env.ts`, `src/web/main.tsx`, `src/web/App.tsx`, `index.html`
- Modify: `.gitignore` (add `.wrangler/`, `.dev.vars`, `fixtures/local/`)
- Test: `test/worker/health.test.ts`

**Interfaces:**
- Produces: `Env` = `{ DB: D1Database; ASSETS: Fetcher; GOOGLE_SA_JSON: string; SHEET_ID: string; SETUP_TOKEN: string; ENVIRONMENT: "development" | "production" }`. Hono app `app` exported from `src/worker/index.ts` with base path `/api`. `GET /api/health` → `{ ok: true }`.

- [ ] **Step 1:** Scaffold with `npm create cloudflare@latest . -- --framework=react --platform=workers --lang=ts --no-git --no-deploy`, then add `hono`, `@tanstack/react-query`, `react-router-dom`, `tailwindcss @tailwindcss/vite`, and dev deps `vitest @cloudflare/vitest-pool-workers @testing-library/react @testing-library/jest-dom jsdom`.
- [ ] **Step 2:** In `wrangler.jsonc` set `name: "dashboard-contempra"`, `assets.not_found_handling: "single-page-application"`, `run_worker_first: ["/api/*"]`, the D1 binding `DB` (database `dashboard-contempra`), and `triggers.crons: ["* * * * *"]`. Vitest uses two projects: `worker` (pool-workers, `test/worker/**`) and `web` (jsdom, `test/web/**`). The pure tests in `test/shared/**` go into the `web` project.
- [ ] **Step 3: Write the failing test** `test/worker/health.test.ts`: `SELF.fetch("http://x/api/health")` → status 200, JSON `{ ok: true }`.
- [ ] **Step 4:** Run `npx vitest run test/worker/health.test.ts`. Expected: FAIL (route missing).
- [ ] **Step 5:** Add the route. Run again. Expected: PASS. Also `npm run build` succeeds.
- [ ] **Step 6:** Commit `chore: scaffold worker + react app`.

### Task 2: Domain rules (pure)

**Files:**
- Create: `src/shared/rules.ts`, `src/shared/types.ts`
- Test: `test/shared/rules.test.ts`

**Interfaces:**
- Produces:
  - `type DocketStatus = "active" | "on_hold" | "completed" | "cancelled"`
  - `type Billing = "billed" | "no_charge" | "not_billed" | "cancelled"`
  - `type TimeBucket = "rush_today" | "this_week" | "coming" | "no_due_date"`
  - `parseSheetDate(v: unknown): { iso: string | null; raw: string | null }`. Numbers are Sheets serials (epoch 1899-12-30), valid only for years 2000–2100. Strings: try `Mon DD-YYYY`, `Mon DD, YYYY` and `YYYY-MM-DD`, same year range. Otherwise `iso: null`. `raw` = trimmed original string, or `null` for numbers and empty input.
  - `isRushText(raw: string | null): boolean` → `/^\s*(rush|asap|now)\b/i`
  - `isCancelText(raw: string | null): boolean` → `/^\s*cancel/i`
  - `normalizeAccountManager(v: unknown): string | null` → trim + uppercase, empty → `null`
  - `deriveStatus(d: { comp: boolean; hold: boolean; dueRaw: string | null; invDateRaw: string | null }): DocketStatus`. Priority: cancelled > completed > on_hold > active.
  - `deriveBilling(invDateRaw: string | null): Billing`. Empty → not_billed; `/^\s*no\s*charge/i` → no_charge; cancel → cancelled; else billed.
  - `todayInBusinessTz(now: Date): string` (ISO date, America/Winnipeg) and `weekEnd(todayIso: string): string` (the Sunday on or after today)
  - `deriveTimeBucket(dueIso: string | null, dueRush: boolean, todayIso: string): { bucket: TimeBucket; overdue: boolean }`

- [ ] **Step 1: Write failing tests**, one `it` per line:
  - `parseSheetDate(46314)` → `{ iso: "2026-10-19", raw: null }`
  - `parseSheetDate("Apr 20-2026")` → `{ iso: "2026-04-20", raw: "Apr 20-2026" }`
  - `parseSheetDate("Sep 23, 0202")` → `{ iso: null, raw: "Sep 23, 0202" }`
  - `parseSheetDate("in production")` → `{ iso: null, raw: "in production" }`
  - `parseSheetDate(6697092)` → `{ iso: null, raw: null }`
  - `parseSheetDate("")` and `parseSheetDate(undefined)` → `{ iso: null, raw: null }`
  - `normalizeAccountManager(" mb ")` → `"MB"`; `normalizeAccountManager("JB ")` → `"JB"`
  - `deriveStatus({comp:true, hold:false, dueRaw:"CANCEL 1-DEC-25", invDateRaw:null})` → `"cancelled"`
  - `deriveStatus({comp:false, hold:false, dueRaw:null, invDateRaw:"cancel 24-aug-25"})` → `"cancelled"`
  - `deriveStatus({comp:true, hold:true, …nulls})` → `"completed"`; `{comp:false, hold:true}` → `"on_hold"`; both false → `"active"`
  - `deriveBilling("151409 8-AUG-25")` → `"billed"`; `"NO CHARGE 6-OCT-26"` → `"no_charge"`; `"  "` → `"not_billed"`; `"CANCEL DEC-8-25"` → `"cancelled"`
  - `todayInBusinessTz(new Date("2026-10-20T04:30:00Z"))` → `"2026-10-19"` (still the 19th in Winnipeg)
  - `weekEnd("2026-10-19")` (Monday) → `"2026-10-25"`; `weekEnd("2026-10-25")` → `"2026-10-25"`
  - `deriveTimeBucket(null, true, "2026-10-19")` → `{ bucket: "rush_today", overdue: false }`
  - `deriveTimeBucket("2026-10-15", false, "2026-10-19")` → `{ bucket: "rush_today", overdue: true }`
  - `deriveTimeBucket("2026-10-19", false, "2026-10-19")` → `{ bucket: "rush_today", overdue: false }`
  - `deriveTimeBucket("2026-10-25", false, "2026-10-19")` → `this_week`; `"2026-10-26"` → `coming`; `(null, false, …)` → `no_due_date`
- [ ] **Step 2:** Run `npx vitest run test/shared/rules.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `src/shared/rules.ts`. Use `Intl.DateTimeFormat("en-CA", { timeZone: "America/Winnipeg" })` for today. Date math in UTC on ISO strings.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5:** Commit `feat: domain rules for status, billing and time buckets`.

### Task 3: Sheet row mapper

**Files:**
- Create: `src/worker/sheet/mapRows.ts`
- Test: `test/worker/mapRows.test.ts`

**Interfaces:**
- Consumes: Task 2 rules.
- Produces:
  - `EXPECTED_HEADERS: string[]` = `["Date","Due Date","Work Order","COMP","HOLD","#","Customer","Project","Address","","ROLE","Inv","Inv/Date","Quote / PO DEPOSIT","Notes","LINK"]`. Headers are compared after `trim()` and collapsing whitespace. Column J also accepts `"Account Manager"`.
  - `type DocketRecord = { workOrder: string; sheetRow: number; dateIso: string|null; dateRaw: string|null; dueIso: string|null; dueRaw: string|null; dueRush: boolean; comp: boolean; hold: boolean; seq: string|null; customer: string|null; project: string|null; address: string|null; accountManager: string|null; roleNote: string|null; inv: boolean; invDateRaw: string|null; quotePo: string|null; notes: string|null; link: string|null; status: DocketStatus; billing: Billing; rowHash: string }`
  - `type ReviewItem = { kind: "duplicate_work_order" | "invalid_work_order"; workOrder: string|null; sheetRow: number; rawJson: string }`
  - `class HeaderMismatchError extends Error { column: string }`
  - `mapSheet(values: unknown[][]): Promise<{ dockets: DocketRecord[]; review: ReviewItem[] }>`. `values[0]` is the header row. `sheetRow` is 1-based. Short rows get padded to 16 cells.
- Rules:
  - Fully empty rows are skipped.
  - A Work Order that is not a positive integer (number, or a numeric string) → `invalid_work_order`. Numbers are stored as strings with no decimals (`91487`).
  - Duplicates: the **topmost** occurrence becomes the docket, and *every* occurrence (including the topmost) becomes a `duplicate_work_order` review item.
  - `rowHash` = hex SHA-256 of `JSON.stringify` of the record without `sheetRow` and `rowHash`.

- [ ] **Step 1: Write failing tests:**
  - A header row with column G renamed to `Client` → rejects `HeaderMismatchError` with `column === "G"`.
  - A row `[46314, "RUSH", 91487, false, false, 3, "Tartan Towing", "Decals", "", " mb ", "", false, "", "", "", ""]` → docket with `workOrder "91487"`, `dueRush true`, `accountManager "MB"`, `status "active"`, `billing "not_billed"`.
  - A trailing-trimmed row (only 3 cells) still maps, with nulls.
  - Two rows with WO 90919 at sheet rows 2 and 5 → one docket with `sheetRow 2`, two review items.
  - WO `"abc"` → `invalid_work_order` review item, no docket.
  - The same input twice → identical `rowHash`. Changing `notes` changes it.
- [ ] **Step 2:** Run `npx vitest run test/worker/mapRows.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Use `crypto.subtle.digest("SHA-256", …)`.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat: map Contempra sheet rows to docket records`.

### Task 4: D1 schema

**Files:**
- Create: `migrations/0001_init.sql`
- Test: `test/worker/schema.test.ts`

**Interfaces:**
- Produces these tables (later tasks query them by these exact names):
  - `dockets` with columns `work_order` (TEXT PRIMARY KEY), `sheet_row`, `date_iso`, `date_raw`, `due_iso`, `due_raw`, `due_rush`, `comp`, `hold`, `seq`, `customer`, `project`, `address`, `account_manager`, `role_note`, `inv`, `inv_date_raw`, `quote_po`, `notes`, `link`, `status`, `billing`, `row_hash`, `synced_at`. CHECK constraints on `status` and `billing` with the Task 2 enums. Indexes on `(status, due_iso)`, `billing`, `account_manager`.
  - `review_items(id INTEGER PRIMARY KEY, kind, work_order, sheet_row, raw_json, detected_at)`
  - `sync_state(id INTEGER PRIMARY KEY CHECK(id=1), last_run_at, last_success_at, last_error, rows_seen, rows_changed, rows_deleted)` seeded with `id=1`
  - `users(id INTEGER PRIMARY KEY, username TEXT UNIQUE COLLATE NOCASE NOT NULL, full_name NOT NULL, access_level CHECK IN ('admin','manager','staff'), password_hash NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at)`
  - `roles(id TEXT PRIMARY KEY, label, sort)` seeded with: `designer`/`Designer`/1, `printer_roll`/`Printer Roll`/2, `printer_fb`/`Printer FB`/3, `laminate_roll`/`Laminate Roll`/4, `liquid_lam`/`Liquid Lam`/5, `colex_finish`/`Colex Finish`/6, `finishing`/`Finishing / Packaging`/7
  - `user_roles(user_id REFERENCES users ON DELETE CASCADE, role_id REFERENCES roles, PRIMARY KEY(user_id, role_id))`
  - `sessions(id TEXT PRIMARY KEY, user_id REFERENCES users ON DELETE CASCADE, expires_at, created_at)`
  - `login_attempts(username, attempted_at)` with an index on `(username, attempted_at)`

- [ ] **Step 1: Write a failing test**: after applying migrations (`applyD1Migrations` in the pool-workers setup file), `SELECT count(*) FROM roles` = 7 and `SELECT id FROM sync_state` = 1.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Write the migration. Wire `readD1Migrations("migrations")` into `vitest.config.ts` and a `test/worker/setup.ts`.
- [ ] **Step 4:** Run. Expected: PASS. Run `npx wrangler d1 migrations apply dashboard-contempra --local`. Expected: success.
- [ ] **Step 5:** Commit `feat: initial D1 schema`.

### Task 5: Google Sheets client

**Files:**
- Create: `src/worker/sheet/googleClient.ts`
- Test: `test/worker/googleClient.test.ts`

**Interfaces:**
- Produces: `fetchContempraValues(env: Pick<Env,"GOOGLE_SA_JSON"|"SHEET_ID">, fetchImpl?: typeof fetch): Promise<unknown[][]>`
  - Builds an RS256 JWT from the service-account JSON (`client_email`, `private_key` PKCS8). Scope: `https://www.googleapis.com/auth/spreadsheets.readonly`. Exchanges it at `https://oauth2.googleapis.com/token`. The access token is cached in module scope until 60s before it expires.
  - `GET https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}/values/Contempra!A1:P?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`, returning `values`.
  - Non-2xx or a timeout over 20s → throws `SheetFetchError` with the HTTP status.
- [ ] **Step 1: Write failing tests** with a fake `fetchImpl` and a test RSA key generated in the test via `crypto.subtle.generateKey`:
  - The token request body contains `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`.
  - The values URL equals the exact string above (with a test sheet id).
  - Two consecutive calls → only one token request.
  - The values endpoint returning 503 → rejects `SheetFetchError` with `status 503`.
- [ ] **Step 2:** Run. Expected: FAIL. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat: google sheets read client with service account`.

### Task 6: Sync job

**Files:**
- Create: `src/worker/sync/syncDockets.ts`, `src/worker/routes/sync.ts`
- Modify: `src/worker/index.ts` (the `scheduled` handler calls `runSync`)
- Test: `test/worker/sync.test.ts`

**Interfaces:**
- Consumes: `mapSheet` (Task 3), `fetchContempraValues` (Task 5), the Task 4 tables.
- Produces:
  - `runSync(env: Env, values?: unknown[][]): Promise<SyncResult>`, where `SyncResult = { ok: boolean; rowsSeen: number; rowsChanged: number; rowsDeleted: number; error: string | null }`. When `values` is omitted it fetches from Google.
  - The diff loads `SELECT work_order, row_hash FROM dockets`. It upserts only new or changed hashes, in `env.DB.batch` chunks of 100 statements. It deletes dockets whose WO is no longer in the sheet. It replaces `review_items` completely. It updates `sync_state`.
  - Guards: `HeaderMismatchError` → `ok:false`, `error: "Header mismatch: <col>"`, no writes. Parsed dockets < 50% of the existing count (when the existing count > 100) → `ok:false`, `error: "Sheet returned too few rows (n of m)"`, no writes. Any fetch error → `ok:false`, error message stored, data untouched.
  - Routes: `GET /api/sync/status` (admin, manager) → the `sync_state` row as `SyncStatus` in camelCase. `POST /api/sync/run` (admin) → `SyncResult`. `POST /api/dev/import` (admin, only when `ENVIRONMENT === "development"`, otherwise 404) with body `{ values: unknown[][] }` → `runSync(env, values)`.
- [ ] **Step 1: Write failing tests** (calling `runSync` with `values` directly):
  - First sync with 3 valid rows → `rowsChanged 3`, 3 dockets in D1.
  - The same values again → `rowsChanged 0`.
  - Edit one row's notes → `rowsChanged 1`.
  - Remove one row → `rowsDeleted 1`.
  - Bad header → `ok:false`, `last_error` starts with `Header mismatch`, the docket count is unchanged.
  - With 200 dockets present, a sync with 50 rows → `ok:false`, 200 dockets remain.
  - `/api/dev/import` returns 404 when `ENVIRONMENT=production`.
- [ ] **Step 2:** Run. Expected: FAIL. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat: minute sync of Contempra tab into D1`.

### Task 7: Auth (passwords, sessions, setup, login)

**Files:**
- Create: `src/worker/auth/password.ts`, `src/worker/auth/sessions.ts`, `src/worker/routes/auth.ts`
- Test: `test/worker/auth.test.ts`

**Interfaces:**
- Produces:
  - `hashPassword(pw: string): Promise<string>`, `verifyPassword(pw: string, stored: string): Promise<boolean>` (constant-time compare)
  - `type SessionUser = { id: number; username: string; fullName: string; accessLevel: "admin"|"manager"|"staff"; roles: string[] }`
  - Hono middleware `requireAuth` (sets `c.get("user")`, 401 `{error:"Not signed in"}` otherwise) and `requireLevel(...levels)` (403 `{error:"Not allowed"}`)
  - `POST /api/setup` `{ setupToken, username, fullName, password }`. Works only when `users` is empty and the token equals `SETUP_TOKEN`; otherwise 403. Creates an admin.
  - `POST /api/auth/login` `{ username, password }` → sets `cd_session`, returns `SessionUser`. Wrong credentials, inactive user or unknown user → 401 `{error:"Invalid username or password"}`. 5 failures for one username within 15 minutes → 429 `{error:"Too many attempts. Try again in 15 minutes."}`.
  - `POST /api/auth/logout` → deletes the session and clears the cookie. `GET /api/auth/me` → `SessionUser`.
  - Password rule: at least 8 characters, otherwise 400 `{error:"Password must be at least 8 characters"}`.
- [ ] **Step 1: Write failing tests:**
  - Hash then verify → true; wrong password → false; the stored string starts with `pbkdf2$100000$`.
  - Setup works once, and a second call → 403.
  - Login sets a cookie containing `HttpOnly` and `SameSite=Lax`; `/me` with that cookie → 200 with `accessLevel "admin"`.
  - 5 bad logins then a correct one → 429.
  - Logout, then `/me` → 401.
  - D1 `sessions.id` is not equal to the cookie token value.
- [ ] **Step 2:** Run. Expected: FAIL. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat: username/password auth with sessions`.

### Task 8: Users & roles admin API

**Files:**
- Create: `src/worker/routes/users.ts`
- Test: `test/worker/users.test.ts`

**Interfaces:**
- Consumes: `requireLevel`, `hashPassword` (Task 7).
- Produces (all admin-only, except `GET /api/roles`, which any signed-in user can call):
  - `GET /api/roles` → `{ id, label }[]`, ordered by `sort`.
  - `GET /api/users` → `UserDTO[]`, where `UserDTO = { id, username, fullName, accessLevel, roles: string[], active: boolean }`.
  - `POST /api/users` `{ username, fullName, accessLevel, roles, password }` → `UserDTO`. A duplicate username → 409 `{error:"Username already exists"}`.
  - `PATCH /api/users/:id` with partial `{ fullName, accessLevel, roles, active }`. Setting `active:false` deletes the user's sessions. An admin cannot deactivate or demote themselves → 400 `{error:"You cannot remove your own admin access"}`.
  - `POST /api/users/:id/reset-password` `{ password }` → deletes that user's sessions.
- [ ] **Step 1: Write failing tests:**
  - Create a staff user with roles `["printer_roll","laminate_roll"]` → `GET /api/users` shows both roles.
  - A staff cookie on `GET /api/users` → 403.
  - Deactivate a logged-in staff user → their next `/api/auth/me` → 401.
  - An admin deactivating themselves → 400.
  - An unknown role id → 400 `{error:"Unknown role: x"}`.
- [ ] **Step 2:** Run. Expected: FAIL. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat: user and role management API`.

### Task 9: Dockets query API

**Files:**
- Create: `src/worker/db/dockets.ts`, `src/worker/routes/dockets.ts`
- Test: `test/worker/dockets.test.ts`

**Interfaces:**
- Consumes: the `dockets` and `review_items` tables, `todayInBusinessTz`, `weekEnd`, `deriveTimeBucket`.
- Produces (admin + manager):
  - `GET /api/dockets?view=active|on_hold|history&history=all|completed|cancelled&bucket=rush_today|this_week|coming|no_due_date&am=MB&q=text&page=1` → `{ items: DocketSummary[]; total: number; page: number; pageSize: 50; counts: Record<TimeBucket, number> }`. `counts` reflects the view + `am` + `q` filters, without `bucket`.
  - `DocketSummary = { workOrder, customer, project, accountManager, dateIso, dueIso, dueRaw, status, billing, bucket, overdue }` (in `src/shared/types.ts`).
  - Bucket SQL, with `:today` and `:weekEnd` bound from `todayInBusinessTz(new Date())`: rush = `due_rush=1 OR due_iso <= :today`; this_week = `due_iso > :today AND due_iso <= :weekEnd AND due_rush=0`; coming = `due_iso > :weekEnd AND due_rush=0`; no_due_date = `due_iso IS NULL AND due_rush=0`.
  - `q` matches `work_order` as a prefix, and `customer`/`project`/`address` with `LIKE %q%`.
  - Sorting: active and on_hold → rush first, then `due_iso ASC NULLS LAST`, then `work_order DESC`. History → `work_order DESC`.
  - `GET /api/dockets/:wo` → `DocketDetail` = `DocketSummary` plus all remaining columns and `sheetRow`. Unknown → 404 `{error:"Work order not found"}`.
  - `GET /api/non-billed?tab=ready|open&am=&q=&page=` → same shape plus `ageDays` (today − `date_iso`). Ready = `status='completed' AND billing='not_billed'`; open = `status IN ('active','on_hold') AND billing='not_billed'`. Sorted by `ageDays DESC`.
  - `GET /api/needs-review` → `ReviewItemDTO[]` grouped by `workOrder`.
  - `GET /api/account-managers` → the distinct non-null `account_manager` values with their counts, descending.
- Query functions in `src/worker/db/dockets.ts` take an explicit `now: Date`: `listDockets(db, params: DocketQuery, now: Date)`, `listNonBilled(db, params: NonBilledQuery, now: Date)`, `getDocket(db, wo, now: Date)`, `listReview(db)`, `listAccountManagers(db)`. The routes pass `new Date()`.
- [ ] **Step 1: Write failing tests**, seeding D1 through `runSync(env, values)` with about 10 crafted rows and calling the query functions with `now = new Date("2026-10-19T17:00:00Z")` (the role check is the only route-level test):
  - `view=active&bucket=rush_today` includes the RUSH-text row and the overdue row (`overdue:true`), and excludes the row due next Monday.
  - `counts` sums to `total` without `bucket`.
  - `view=history&history=cancelled` returns only rows where `CANCEL` appears in Due Date or Inv/Date.
  - `non-billed?tab=ready` excludes `NO CHARGE` and `CANCEL` rows.
  - `q=914` matches WO `91487`.
  - A staff cookie → 403.
- [ ] **Step 2:** Run. Expected: FAIL. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat: docket list, detail, non-billed and review APIs`.

### Task 10: Web shell — API client, auth, layout, login

**Files:**
- Create: `src/web/api.ts`, `src/web/auth.tsx`, `src/web/components/Layout.tsx`, `src/web/pages/Login.tsx`, `src/web/pages/MyCards.tsx`
- Modify: `src/web/App.tsx`, `src/web/main.tsx`
- Test: `test/web/login.test.tsx`

**Interfaces:**
- Consumes: the Task 7 endpoints.
- Produces: `api<T>(path, init?)` (JSON, `credentials:"include"`, throws `ApiError { status, message }` using the server's `error`), `useAuth(): { user: SessionUser | null; loading; login(u,p); logout() }`, and `<RequireLevel levels>` route guard.
- Routes: `/login`; `/` redirects to `/dashboard` for admin/manager and to `/my-cards` for staff; `/dashboard`, `/non-billed`, `/needs-review`, `/admin/users`, `/my-cards`.
- Layout: bottom tab bar under 768px, left sidebar at 768px and above. Items: `Main Dashboard`, `Non Billed Jobs`, `Needs Review`, `Admin` (filtered by level), `My Cards`, and `Sign out` in the account menu. Uses design tokens through CSS variables, with light and dark themes.
- `MyCards` page (Phase 1 placeholder): heading `My Cards`, text `Your production cards will appear here soon.`
- [ ] **Step 1: Write failing tests** (with a mocked `fetch`):
  - Submitting wrong credentials shows `Invalid username or password`.
  - A successful login as staff navigates to `My Cards`.
  - A staff user does not see `Non Billed Jobs` in the nav.
- [ ] **Step 2:** Run `npx vitest run --project web`. Expected: FAIL. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat: web shell with login and role-aware navigation`.

### Task 11: Main Dashboard UI

**Files:**
- Create: `src/web/pages/Dashboard.tsx`, `src/web/components/DocketList.tsx`, `src/web/components/DocketDetail.tsx`, `src/web/components/BucketChip.tsx`, `src/web/components/SyncBadge.tsx`
- Test: `test/web/dashboard.test.tsx`

**Interfaces:**
- Consumes: `GET /api/dockets`, `/api/dockets/:wo`, `/api/account-managers`, `/api/sync/status`.
- Behavior:
  - View tabs: `Active` · `On Hold` · `History`. History has a sub-filter `All` · `Completed` · `Cancelled`.
  - Bucket chips with counts: `Rush / Today (n)` · `This Week (n)` · `Coming (n)` · `No Due Date (n)`, plus `All`.
  - An `Account Manager` select and a search box (`Search work order, customer, project…`, debounced 250ms).
  - Filters live in the URL query string.
  - List rows/cards show WO, Customer, Project, the `Account Manager` badge, the due label (the date as `Oct 21`, or `dueRaw` when it isn't a date) and an `Overdue` badge.
  - Tapping a row opens `DocketDetail`: a full-screen sheet on mobile, a side panel on desktop, with every field labeled. Column J is labeled `Account Manager`.
  - `SyncBadge` shows `Synced just now` / `Last synced N min ago`. Past 5 minutes it turns to the warning style; when `lastError` is set it shows `Sync problem — showing last saved data`.
  - Data refetches every 30s (TanStack Query `refetchInterval`).
  - `Load more` paginates.
- [ ] **Step 1: Write failing tests:**
  - Rendering with mocked counts shows the `Rush / Today (3)` text.
  - Clicking `This Week` adds `bucket=this_week` to the request URL.
  - A row with `dueRaw "in production"` and `dueIso null` shows `in production`.
  - A sync status with `lastSuccessAt` 7 min ago shows `Last synced 7 min ago` with the warning role.
- [ ] **Step 2:** Run. Expected: FAIL. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat: main dashboard with views, buckets, filters and detail`.

### Task 12: Non Billed Jobs, Needs Review and Admin Users UI

**Files:**
- Create: `src/web/pages/NonBilled.tsx`, `src/web/pages/NeedsReview.tsx`, `src/web/pages/AdminUsers.tsx`
- Test: `test/web/nonBilled.test.tsx`, `test/web/adminUsers.test.tsx`

**Interfaces:**
- Consumes: `/api/non-billed`, `/api/needs-review`, `/api/users`, `/api/roles`, `/api/sync/run`.
- Behavior:
  - **Non Billed:** tabs `Ready to Bill` / `Open – Not Billed` with counts, an `Account Manager` filter, search, and rows showing `ageDays` as `12 days`. It reuses `DocketDetail`.
  - **Needs Review:** grouped by Work Order, with the heading `Duplicate work order 90919 (2 rows)` and the sheet row numbers. Invalid ones appear as `Invalid work order on row 1793`.
  - **Admin Users:** a list with access level and role chips; `Add user` and `Edit` forms (Username, Full name, Access level, Roles as a multi-select checkbox list, Password); `Reset password`; an `Active` toggle; and a `Sync now` button showing the result.
- [ ] **Step 1: Write failing tests:**
  - The Non Billed `Ready to Bill` tab requests `tab=ready`; switching tabs requests `tab=open`.
  - Admin Users: saving a new user posts the selected roles array; a 409 response shows `Username already exists`.
- [ ] **Step 2:** Run. Expected: FAIL. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat: non billed, needs review and user admin screens`.

### Task 13: Local fixture import

**Files:**
- Create: `scripts/xlsx_to_values.py`, `scripts/import-fixture.mjs`, `README.md` (Local development section)

**Interfaces:**
- Consumes: `POST /api/dev/import` (Task 6).
- `python -I scripts/xlsx_to_values.py "<path to xlsx>" fixtures/local/contempra-values.json` writes `{"values": [[...], ...]}` for the `Contempra` sheet columns A–P. Dates become Sheets serial numbers; booleans stay booleans; empty cells become `""`.
- `node scripts/import-fixture.mjs fixtures/local/contempra-values.json http://localhost:5173 <username> <password>` logs in and posts to `/api/dev/import`, then prints the `SyncResult`.
- [ ] **Step 1:** Implement both scripts.
- [ ] **Step 2: Verify:** run against `C:\Users\meinrad\Downloads\Workorder Books TEST.xlsx` with `npm run dev`. Expected: `ok: true`, `rowsSeen` ≈ 11660, and `Needs Review` lists the duplicate WOs (for example 90919).
- [ ] **Step 3: Verify in the browser** at 375px and at desktop width: the dashboard loads, the bucket counts are non-zero, and no screen scrolls horizontally.
- [ ] **Step 4:** Commit `chore: local fixture import for development`. Confirm `fixtures/local` is not staged.

### Task 14: Deploy

**Files:**
- Modify: `wrangler.jsonc` (real `database_id`), `README.md` (Deploy and Google setup sections)

- [ ] **Step 1 (owner):** Create a Google Cloud project, enable the Sheets API, create a service account and a JSON key, and share the **backup** sheet with the service account email as **Viewer**.
- [ ] **Step 2:** `npx wrangler d1 create dashboard-contempra` → put the id in `wrangler.jsonc`. Then `npx wrangler d1 migrations apply dashboard-contempra --remote`.
- [ ] **Step 3:** `npx wrangler secret put GOOGLE_SA_JSON`, `SHEET_ID` and `SETUP_TOKEN`. Set `ENVIRONMENT=production` in `vars`.
- [ ] **Step 4:** `npm run deploy`. Then call `POST /api/setup` once to create the first admin.
- [ ] **Step 5: Verify:** `POST /api/sync/run` → `ok:true`. After 2 minutes, `GET /api/sync/status` shows `lastSuccessAt` within the last 60s. The dashboard on a phone shows live data.
- [ ] **Step 6:** Commit `chore: production deploy config` and push.
