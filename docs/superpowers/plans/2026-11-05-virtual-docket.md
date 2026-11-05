# Virtual Docket Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A digital copy of the paper Contempra docket, filled on a PC or iPad, that writes the docket's row to the Google Sheet, stores the full docket plus its production routing, and saves a matching PDF to R2 and Google Drive. The docket can be edited, cancelled, sent to Trash and restored.

**Architecture:** The Google connection moves from the service account to the sheet owner's OAuth token, stored encrypted in D1. The Worker writes the sheet through a small `SheetGateway` interface and Drive through a `DriveGateway` interface; tests inject fakes for both. The PDF is rendered in the browser with `@react-pdf/renderer` and uploaded to R2. Drive copies happen in the background, and failures are retried by the 5-minute cron.

**Tech Stack:** Existing stack (Workers + Hono + D1 + React/Tailwind v4 + Vitest), plus Cloudflare R2 and `@react-pdf/renderer` (browser only, lazy-loaded).

**Spec:** `docs/superpowers/specs/2026-11-05-virtual-docket-design.md` (and the base spec `2026-10-19-dashboard-contempra-design.md`).

## Global Constraints

- All user-facing text is English, using the spec's labels exactly. Paper labels are kept verbatim (`FOR`, `ADDRESS`, `P.O. No.`, `G.S.T. No.` …).
- Free Cloudflare plan only. The Worker never renders PDFs. Every Google call happens per user action or in the existing crons.
- OAuth scopes are exactly `https://www.googleapis.com/auth/spreadsheets` and `https://www.googleapis.com/auth/drive.file`, with `access_type=offline` and `prompt=consent`.
- The refresh token is stored only AES-GCM encrypted with the `TOKEN_KEY` secret. Plaintext never lands in D1 or logs.
- Sheet rows are always located by Work Order (column C), never by a cached row number.
- Write policy per column follows spec §4: M and N are written only when the form value is non-empty; C, D, E, F, K, L and O are never touched on edit.
- Price fields (`materials[].cost`, all totals) are never sent to Staff by any endpoint.
- The Drive layout is `Contempra Dockets/<year>/<WO> - <FOR>.pdf`.
- The cancel stamp is `CANCEL D-MMM-YY` with an uppercase month, e.g. `CANCEL 5-NOV-26`.
- Taxes are GST 5% and PST 7%, and both stay editable.
- Touch targets are at least 44px. The form works at 1024×1366 and 1366×1024 with no horizontal scroll. The Production panel sits beside the paper at ≥1180px and below it otherwise.

## Review Focus

1. **Two people press Save at the same moment.** Each docket must get a distinct Work Order # and its own sheet row (test in Task 4).
2. **Google write fails mid-save** (network or 5xx). Nothing is left in D1 and the user sees `Could not save to Google Sheet. Nothing was saved. Try again.` (test in Task 4).
3. **The docket being edited was deleted or moved in the sheet by hand.** Moved: the edit still lands on the right row. Deleted: the user gets `This work order is no longer in the Google Sheet` (test in Task 4).
4. **The owner revokes access** (Google returns `invalid_grant`). The connection is marked disconnected and saves fail with `Google is disconnected. Ask an admin to reconnect.` (test in Task 1).
5. **Staff opens a docket or its PDF.** No price ever reaches them, and the stored PDF with prices returns 403 for Staff (tests in Tasks 4 and 5).

---

## File Structure

```
migrations/0003_virtual_dockets.sql
src/shared/docketForm.ts            form type, empty form, totals, body summary, sheet mapping, cancel stamp, stripPrices
src/worker/google/crypto.ts         encryptSecret / decryptSecret (AES-GCM)
src/worker/google/oauth.ts          auth URL, code exchange, access-token provider, connection row
src/worker/google/sheets.ts         SheetGateway (read range, insert top row, update cells, delete row)
src/worker/google/drive.ts          DriveGateway (ensure folders, upload/replace, trash)
src/worker/google/gateways.ts       getGateways(env) + test override
src/worker/dockets/service.ts       create / update / cancel / delete / restore / purge
src/worker/routes/google.ts         /api/google/*
src/worker/routes/virtualDockets.ts /api/virtual-dockets/*, /api/trash
src/web/docket/DocketPaper.tsx      on-screen paper replica (edit + read-only)
src/web/docket/ProductionPanel.tsx  jobs, routes, assignees
src/web/docket/DocketPdf.tsx        @react-pdf/renderer document
src/web/docket/useDraft.ts          localStorage autosave
src/web/pages/DocketEditor.tsx      /dockets/new, /dockets/:wo
src/web/pages/Trash.tsx
src/web/pages/GoogleConnection.tsx  (rendered inside Admin)
```

---

### Task 1: Google connection (OAuth, encrypted token, sync on OAuth)

**Files:**
- Create: `migrations/0003_virtual_dockets.sql`, `src/worker/google/crypto.ts`, `src/worker/google/oauth.ts`, `src/worker/routes/google.ts`
- Modify: `src/worker/env.ts` (add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOKEN_KEY`, `DOCKETS_BUCKET: R2Bucket`; remove `GOOGLE_SA_JSON` and `SHEET_ID`), `src/worker/sheet/googleClient.ts` (take the access token from `getAccessToken(env)`), `src/worker/sync/*.ts` and `routes/sync.ts` (`isSheetConfigured` becomes async), `wrangler.jsonc` (R2 binding `DOCKETS_BUCKET` → bucket `contempra-dockets`), `vitest.config.ts` bindings
- Test: `test/worker/google.test.ts`; update the sync, scheduled and syncRoutes tests to use a `seedConnection()` helper in `test/worker/helpers.ts`

**Interfaces:**
- Produces:
  - Migration 0003 creates:
    - `google_connection(id INTEGER PRIMARY KEY CHECK(id=1), email, refresh_token_enc, sheet_id, sheet_gid INTEGER, drive_folder_id, status CHECK IN ('connected','disconnected'), connected_at, connected_by)`
    - `virtual_dockets(work_order TEXT PRIMARY KEY, state CHECK IN ('saving','saved'), form_json, version INTEGER NOT NULL DEFAULT 1, pdf_key, drive_file_id, drive_link, drive_status CHECK IN ('none','pending','done','failed') DEFAULT 'none', created_by, created_at, updated_by, updated_at, deleted_at, deleted_by, deleted_row_json)`
    - `docket_jobs(id INTEGER PRIMARY KEY, work_order REFERENCES virtual_dockets ON DELETE CASCADE, name, sort)`
    - `job_steps(job_id REFERENCES docket_jobs ON DELETE CASCADE, step INTEGER, role_id REFERENCES roles, assignee_ids TEXT NOT NULL DEFAULT '[]', PRIMARY KEY(job_id, step))`
    - `oauth_states(state TEXT PRIMARY KEY, user_id, created_at)`
  - `encryptSecret(plain: string, keyB64: string): Promise<string>` / `decryptSecret(enc: string, keyB64: string): Promise<string>`. Format: `v1.<ivB64>.<cipherB64>`.
  - `buildAuthUrl(env, state, redirectUri): string`
  - `exchangeCode(env, code, redirectUri, fetchImpl?): Promise<{ refreshToken: string; email: string }>`. The email comes from the id_token or the userinfo endpoint (add the `openid email` scopes for this).
  - `getAccessToken(env, fetchImpl?): Promise<string>` caches the token in module scope. On `invalid_grant` it sets `status='disconnected'` and throws `GoogleDisconnectedError("Google is disconnected. Ask an admin to reconnect.")`.
  - `isSheetConfigured(env): Promise<boolean>`: the connection row is `connected` and `sheet_id` is not null.
  - Routes (admin only, except `/callback`, which validates `state` against `oauth_states` within 10 minutes):
    - `GET /api/google/connect` → 302 to Google.
    - `GET /api/google/callback?code&state` → stores the connection, creates the `Contempra Dockets` Drive folder (Task 3's `DriveGateway.ensureRootFolder`), then 302 `/admin/users?google=connected`.
    - `GET /api/google/status` → `{ connected, email, sheetUrl }`.
    - `PUT /api/google/sheet { url }` → extracts the ID with `/\/d\/([a-zA-Z0-9-_]+)/`, reads `spreadsheets.get?fields=sheets.properties` to find the gid of the tab titled `Contempra`, and stores both. An invalid URL → 400 `{error:"That doesn't look like a Google Sheet link"}`. No `Contempra` tab → 400 `{error:"This sheet has no 'Contempra' tab"}`.
    - `POST /api/google/disconnect`.
- [ ] **Step 1: Write failing tests:**
  - Encrypt then decrypt round-trips. The ciphertext does not contain the plaintext. A wrong key throws.
  - `buildAuthUrl` contains both scopes, `access_type=offline` and `prompt=consent`.
  - `getAccessToken` with a fake fetch returning 400 `{"error":"invalid_grant"}` → rejects `GoogleDisconnectedError`, and `google_connection.status` becomes `disconnected`.
  - Callback with an unknown state → 400.
  - `PUT /api/google/sheet` with `https://docs.google.com/spreadsheets/d/abc123/edit` and a fake gateway listing a `Contempra` tab stores `sheet_id='abc123'`.
  - Existing sync tests pass after switching to `seedConnection()`.
- [ ] **Step 2:** Run `npx vitest run test/worker`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement. The token endpoint is `https://oauth2.googleapis.com/token` (`grant_type=refresh_token`). The callback `redirectUri` is `new URL("/api/google/callback", c.req.url)`.
- [ ] **Step 4:** Run `npx vitest run`. Expected: all tests PASS. `npm run typecheck` is clean.
- [ ] **Step 5:** Commit `feat: connect Google with the sheet owner's OAuth account`.

### Task 2: Docket form domain (pure)

**Files:**
- Create: `src/shared/docketForm.ts`
- Test: `test/shared/docketForm.test.ts`

**Interfaces:**
- Produces:
  - `type DocketForm = { quoteNo: string; date: string /*YYYY-MM-DD*/; required: { kind: "date"; date: string } | { kind: "text"; text: "RUSH" | "ASAP" | "NOW" } | { kind: "none" }; forName: string; address: string; contact: string; phone: string; fax: string; email: string; poNo: string; invoiceNo: string; orderTakenBy: string; salesperson: string; cod: boolean; charge: boolean; newAccount: boolean; repeat: boolean; body: string; proofRequired: boolean; labour: { name: string; work: string; hrs: string; date: string }[] /*8*/; materials: { name: string; cost: string }[] /*7*/; savedAs: string; delivery: string; gst: string | null; pst: string | null; deposit: string; service: ("INSTALLATION"|"DELIVERY"|"SERVICE"|"PICKUP")[]; callWhenReady: boolean; goodsReceivedBy: string }`
  - `type ProductionJob = { name: string; steps: { roleId: string; assigneeIds: number[] }[] }`
  - `emptyForm(todayIso: string, orderTakenBy: string): DocketForm`
  - `computeTotals(f: DocketForm): { total: number; subtotal: number; gst: number; pst: number; grandTotal: number; balanceDue: number }`. Amounts are rounded to cents. `gst`/`pst` use the override string when it is not null, otherwise 5% / 7% of the subtotal.
  - `summarizeBody(body: string): string`: non-empty trimmed lines joined with ` / `, cut at 200 characters on a word boundary with `…`.
  - `toSheetCells(f: DocketForm, wo: string, mode: "create" | "edit"): Record<"A"|"B"|"C"|"D"|"E"|"G"|"H"|"I"|"J"|"L"|"M"|"N", string | number | boolean>`. Only the keys to write; dates as Sheets serial numbers (inverse of `parseSheetDate`).
  - `cancelStamp(d: Date): string`, using the America/Winnipeg date.
  - `stripPrices(f: DocketForm): DocketForm`: blank `cost`, `delivery`, `deposit`, and `gst`/`pst` = null.
  - `formFromDocket(d: DocketDetail): DocketForm` prefills a form from sheet data (spec §5, "Dockets que nacieron en la hoja").
- [ ] **Step 1: Write failing tests:**
  - `computeTotals` with costs `["100", "50.5"]`, delivery `"10"` → total 150.5, subtotal 160.5, gst 8.03, pst 11.24, grandTotal 179.77. Deposit `"50"` → balanceDue 129.77.
  - A GST override `"0"` → gst 0.
  - `summarizeBody("exterior letters?\n\n  interior sign\nawning decal")` → `"exterior letters? / interior sign / awning decal"`. A 500-character body → length ≤ 200, ending with `…`.
  - `toSheetCells(form, "91488", "create")` → C 91488, D false, E false, L false, G from `forName`, J = salesperson, A = serial for the date. With `required: {kind:"text", text:"RUSH"}`, B = `"RUSH"`.
  - Edit mode with an empty `invoiceNo` → no `M` key. Edit mode never has the keys C, D, E or L.
  - `cancelStamp(new Date("2026-11-05T18:00:00Z"))` → `"CANCEL 5-NOV-26"`.
  - `stripPrices` blanks every cost and nulls gst/pst; other fields are unchanged.
- [ ] **Step 2:** Run `npx vitest run test/shared/docketForm.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. **Step 4:** Run. Expected: PASS. **Step 5:** Commit `feat: docket form model, totals and sheet mapping`.

### Task 3: Sheet and Drive gateways

**Files:**
- Create: `src/worker/google/sheets.ts`, `src/worker/google/drive.ts`, `src/worker/google/gateways.ts`
- Test: `test/worker/gateways.test.ts`

**Interfaces:**
- Consumes: `getAccessToken` (Task 1).
- Produces:
  - `interface SheetGateway { readRange(a1: string): Promise<unknown[][]>; findRow(wo: string): Promise<number | null>; insertTopRow(cells: Partial<Record<string, unknown>>): Promise<void>; updateCells(row: number, cells: Partial<Record<string, unknown>>): Promise<void>; deleteRow(row: number): Promise<void> }`
    - `findRow` reads `Contempra!C1:C` and returns the 1-based row of the first match.
    - `insertTopRow` sends one `spreadsheets.batchUpdate` with `insertDimension` (sheetId = stored gid, ROWS 1–2) plus `updateCells` for the given columns of row 2, using `USER_ENTERED`-equivalent typed values.
  - `interface DriveGateway { ensureRootFolder(): Promise<string>; upload(wo: string, title: string, year: number, pdf: ArrayBuffer, existingId?: string | null): Promise<{ id: string; link: string }>; trash(fileId: string): Promise<void> }`
    - `upload` uses multipart to `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink`. With an `existingId` it does a `PATCH` media update, which keeps Drive's version history.
  - `getGateways(env): { sheet: SheetGateway; drive: DriveGateway }` and `__setTestGateways(g | null)` (test-only override, ignored when `ENVIRONMENT === "production"`).
  - `test/worker/fakeGoogle.ts`: an in-memory `FakeSheet` (2-D array, the same A1 slicing as `incremental.test.ts`'s `fakeSheet`, `failNext(op)` to simulate errors) and `FakeDrive` (a map of files, `failNext()`).
- [ ] **Step 1: Write failing tests** with a fake `fetch` against the real gateways:
  - `insertTopRow({C: 91488, G: "Encore Lounge"})` sends exactly one POST to `…/spreadsheets/<id>:batchUpdate` whose body contains `insertDimension` with `startIndex: 1` and the cell values.
  - `findRow("91376")` returns 4 when column C is `[["Work Order"],[91488],[91377],[91376]]`.
  - `upload` with an `existingId` uses `PATCH` on `…/upload/drive/v3/files/<id>`.
- [ ] **Step 2:** Run. Expected: FAIL. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat: Google Sheets and Drive gateways`.

### Task 4: Docket service and API (create, read, edit, cancel, delete, restore)

**Files:**
- Create: `src/worker/dockets/service.ts`, `src/worker/routes/virtualDockets.ts`
- Modify: `src/worker/index.ts` (mount the routes), `src/shared/types.ts` (`VirtualDocketDTO`)
- Test: `test/worker/virtualDockets.test.ts`

**Interfaces:**
- Consumes: Tasks 2 and 3, `requireLevel`, the `dockets` mirror and `mapSheet` (for the mirror upsert).
- Produces:
  - `VirtualDocketDTO = { workOrder: string; form: DocketForm; jobs: ProductionJob[]; version: number; source: "virtual" | "sheet"; pdf: { stored: boolean; driveLink: string | null; driveStatus: string }; deletedAt: string | null }`
  - `POST /api/virtual-dockets { form, jobs }` (admin, manager) → `VirtualDocketDTO`. Steps per spec §5:
    1. Reserve the WO as max(mirror, sheet `C2:C51`) + 1, with up to 5 retries on PK conflict.
    2. `sheet.insertTopRow(toSheetCells(...,"create"))`.
    3. On error: delete the reservation, then 502 `{error:"Could not save to Google Sheet. Nothing was saved. Try again."}`.
    4. Mark `saved`, insert jobs and steps, and upsert the `dockets` mirror.
  - `GET /api/virtual-dockets/:wo` (any signed-in user):
    - Staff get `stripPrices(form)`.
    - With no virtual row but a mirror row → `source:"sheet"` and `formFromDocket`.
    - Neither → 404.
  - `PUT /api/virtual-dockets/:wo { form, jobs, version }` (admin, manager):
    - A version mismatch → 409 `{error:"This docket was changed by <full name>. Reload to see the latest version."}`.
    - `findRow` null → 409 `{error:"This work order is no longer in the Google Sheet"}`.
    - Otherwise `updateCells(row, toSheetCells(...,"edit"))`, then `version+1`, replace the jobs and upsert the mirror.
    - A `source:"sheet"` docket creates its virtual row here.
  - `POST /api/virtual-dockets/:wo/cancel` (admin, manager): writes `M = cancelStamp(now)` and upserts the mirror (status cancelled).
  - `DELETE /api/virtual-dockets/:wo` (admin, body `{ confirm: wo }`): `findRow`, then save A–P into `deleted_row_json`, `deleteRow`, set `deleted_at`/`deleted_by`, and delete the mirror row.
  - `POST /api/virtual-dockets/:wo/restore` (admin): `insertTopRow(deleted_row_json)`, clear the deletion fields, upsert the mirror.
  - `GET /api/trash` (admin) → `{ workOrder, forName, deletedAt, deletedBy, daysLeft }[]`.
  - `purgeTrash(env, now)` (called by the nightly cron): deletes rows with `deleted_at` older than 30 days from R2, Drive (`trash`) and D1.
- [ ] **Step 1: Write failing tests** (FakeSheet/FakeDrive through `__setTestGateways`):
  - Create → the FakeSheet row 2 has C = new WO and G = `forName`. A mirror docket exists. The jobs are stored.
  - **Two concurrent `POST`s** (`Promise.all`) → two different WOs and two sheet rows.
  - **`failNext("insertTopRow")`** → 502 with the exact message. No `virtual_dockets` row. The mirror is unchanged.
  - Staff `GET` → every `materials[].cost` is `""` and `gst` is null. A manager `GET` keeps the costs.
  - **Edit after someone inserted 3 rows above** (the FakeSheet shifted) → the right row is updated. **Edit after the row was removed** → 409 `This work order is no longer in the Google Sheet`.
  - Edit with a stale version → 409 containing `This docket was changed by`.
  - Edit with an empty `invoiceNo` leaves the existing M (`"151409 8-AUG-25"`) unchanged.
  - Cancel → M starts with `CANCEL `. The mirror status is `cancelled`.
  - Delete → the row is gone from the FakeSheet and `GET /api/trash` lists it. Restore → the row is back at row 2.
  - `purgeTrash` at deleted_at + 31 days removes it from R2, D1 and FakeDrive. At + 29 days it stays.
  - Staff `POST` → 403. Manager `DELETE` → 403.
  - The gateway throwing `GoogleDisconnectedError` on create → 503 `{error:"Google is disconnected. Ask an admin to reconnect."}`, and nothing is stored.
- [ ] **Step 2:** Run. Expected: FAIL. **Step 3:** Implement. Wire `purgeTrash` into `runNightlyReconcile`'s caller in `scheduled`. **Step 4:** Run the whole suite. Expected: PASS.
- [ ] **Step 5:** Commit `feat: virtual docket API with sheet write path, cancel and trash`.

### Task 5: PDF storage and Drive copy

**Files:**
- Modify: `src/worker/routes/virtualDockets.ts`, `src/worker/sync/incremental.ts` (retry pending Drive uploads), `src/worker/index.ts`
- Test: `test/worker/docketPdf.test.ts`

**Interfaces:**
- Produces:
  - `PUT /api/virtual-dockets/:wo/pdf` (admin, manager). Body: raw `application/pdf`, at most 5 MB, otherwise 413. It is stored in R2 at `dockets/<wo>.pdf` and sets `drive_status='pending'`. It then runs `syncDocketPdfToDrive(env, wo)` in `waitUntil`.
  - `syncDocketPdfToDrive(env, wo): Promise<void>`: `drive.upload(...)` (replacing `drive_file_id` when set) → `drive_status='done'`, `drive_link`. It writes the link to column P with `sheet.updateCells(findRow(wo), {P: link})`. On error: `drive_status='failed'`, retried later.
  - `retryPendingDrive(env, limit = 5)` runs at the end of each incremental sync for rows with status `pending` or `failed`.
  - `GET /api/virtual-dockets/:wo/pdf` (admin, manager) streams from R2 with `content-type: application/pdf`. Staff → 403 (they generate a price-free PDF in the browser instead).
- [ ] **Step 1: Write failing tests:**
  - PUT stores the R2 object and ends with `drive_status` `done`. FakeSheet column P holds the Drive link.
  - `FakeDrive.failNext()` → status `failed`. `retryPendingDrive` → `done`.
  - A second PUT replaces the same Drive file id.
  - A 6 MB body → 413.
  - Staff GET → 403.
- [ ] **Step 2–4:** RED → implement → GREEN (full suite).
- [ ] **Step 5:** Commit `feat: docket PDF storage in R2 with Drive copy and retry`.

### Task 6: Google Connection admin UI

**Files:**
- Create: `src/web/pages/GoogleConnection.tsx`
- Modify: `src/web/pages/AdminUsers.tsx` (render the panel above the sync panel)
- Test: `test/web/googleConnection.test.tsx`

**Interfaces:**
- Consumes: the `/api/google/*` routes.
- Behavior:
  - Disconnected → text `Connect the Google account that owns the Workorder Books sheet.` and the button `Connect Google` (navigates to `/api/google/connect`).
  - Connected → `Connected as <email>`, a `Google Sheet URL` input with `Save`, and `Disconnect`, which asks for confirmation.
  - A `?google=connected` query → the toast `Google connected`.
- [ ] **Step 1: Write failing tests:** the disconnected state shows `Connect Google`. Saving a URL PUTs `{url}`. A 400 error message is shown.
- [ ] **Step 2–4:** RED → implement → GREEN.
- [ ] **Step 5:** Commit `feat: Google connection panel in Admin`.

### Task 7: Paper replica form, Production panel and draft autosave

**Files:**
- Create: `src/web/docket/DocketPaper.tsx`, `src/web/docket/ProductionPanel.tsx`, `src/web/docket/useDraft.ts`, `src/web/pages/DocketEditor.tsx`
- Modify: `src/web/App.tsx` (routes `/dockets/new` and `/dockets/:wo`, the editor for admin/manager and read-only for staff), `src/web/pages/Dashboard.tsx` (the `New Docket` primary button in the header)
- Test: `test/web/docketEditor.test.tsx`

**Interfaces:**
- Consumes: Task 2 (`emptyForm`, `computeTotals`, `DocketForm`, `ProductionJob`), the Task 4 API, `/api/roles`, `/api/users`.
- Produces:
  - `<DocketPaper form onChange readOnly showPrices />`: paper proportion 8.5:11 (`aspect-[8.5/11]` min height, grows with the body). Layout, order and labels follow spec §3. The body is one auto-growing `<textarea aria-label="Job details">`.
  - `<ProductionPanel jobs onChange roles users />`: starts with `Whole docket`. `+ Add job`. Role chips in route order. A per-step assignee multi-select filtered by role.
  - `useDraft(key: string, value: DocketForm & {jobs}, enabled: boolean)` saves to `localStorage` every 5 s (try/catch), under `docket-draft:new` or `docket-draft:<wo>`. It returns `{ restore(): Draft | null; clear(): void }`.
  - `DocketEditor`:
    - Top bar: `Save`, `Save & New`, `Cancel`, the draft status `Draft saved`, and the WO shown as `New` until saved.
    - On load with a stored draft → the banner `Restore draft?` with `Restore` and `Discard`.
    - After Save → navigate to `/dockets/<wo>` and run the PDF upload (Task 8).
- [ ] **Step 1: Write failing tests:**
  - Typing in `FOR` and `Job details` and clicking `Save` POSTs a body whose `form.forName` and `form.body` match, plus `jobs[0].name === "Whole docket"`.
  - Costs `100` + `50.50` show `GRAND TOTAL` `$179.77` (with delivery 10).
  - A staff user sees no price inputs: `queryByLabelText("COST 1")` is null.
  - A draft in localStorage shows `Restore draft?`.
  - A 502 response shows `Could not save to Google Sheet. Nothing was saved. Try again.` and keeps the form filled.
- [ ] **Step 2–4:** RED → implement → GREEN.
- [ ] **Step 5:** Verify in the browser at 1024×1366 and 1366×1024 (iPad), plus 1440×900: no horizontal scroll, the Production panel beside the paper at ≥1180px wide and below it otherwise.
- [ ] **Step 6:** Commit `feat: virtual docket editor with paper replica and production panel`.

### Task 8: PDF in the browser and docket actions

**Files:**
- Create: `src/web/docket/DocketPdf.tsx`, `src/web/pages/Trash.tsx`
- Modify: `src/web/components/DocketDetail.tsx` (actions), `src/web/pages/DocketEditor.tsx` (upload after save), `src/web/App.tsx` (`/admin/trash`), `src/web/components/Layout.tsx` (Admin nav gets the `Trash` sub-link), `package.json` (`@react-pdf/renderer`)
- Test: `test/web/docketActions.test.tsx`

**Interfaces:**
- Produces:
  - `<DocketPdf form showPrices />`: a `@react-pdf/renderer` `Document` with one LETTER page and Helvetica. The same boxes, labels and positions as `DocketPaper`, with a vector header `CONTEMPRA SIGNS`.
  - `renderDocketPdf(form, showPrices): Promise<Blob>` dynamic-imports `@react-pdf/renderer` (code split, not in the main bundle).
  - Detail modal actions by permission: `Open Docket`, `Download PDF`, `Open in Drive` (when `driveLink`), `Edit`, `Cancel docket` (confirm `Cancel work order <wo>? It will move to History.`) and `Delete` (admin: type the WO to confirm).
  - `Download PDF`: admin/manager GET the stored PDF. Staff get a client render with `showPrices=false`.
  - `Trash` page: the list with `<n> days left`, `Restore`, and the empty state `Trash is empty.`.
- [ ] **Step 1: Write failing tests** (mock `renderDocketPdf`):
  - After a successful save the editor PUTs a Blob to `/api/virtual-dockets/<wo>/pdf`.
  - The staff detail modal shows `Download PDF` but no `Edit`, `Cancel docket` or `Delete`.
  - `Delete` stays disabled until the typed WO matches.
  - Trash `Restore` POSTs to `/restore`.
  - Opening a docket as a manager when `pdf.stored === false` regenerates the PDF and PUTs it (the spec's `PDF pending` case).
- [ ] **Step 2–4:** RED → implement → GREEN (full suite and `npm run build`). Confirm `@react-pdf/renderer` is in a separate chunk in the build output.
- [ ] **Step 5:** Manual check: generate a PDF from a real docket, print it, and compare it side by side with the paper form. Record the result in the ledger.
- [ ] **Step 6:** Commit `feat: docket PDF, docket actions and trash`.

### Task 9: Go-live steps (owner + deploy)

- [ ] **Step 1 (owner, guided):** Google Cloud project → OAuth consent screen (External, **publish "In production"**) → OAuth client "Web application" with the redirect URI `https://dashboard-contempra.digitalcontempra.workers.dev/api/google/callback`.
- [ ] **Step 2:** `npx wrangler r2 bucket create contempra-dockets`, then `wrangler secret put` for `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `TOKEN_KEY` (32 random bytes, base64). Apply migration 0003 remotely. Deploy.
- [ ] **Step 3 (owner):** Admin → `Connect Google` with the account that owns the **SAMPLE** sheet, then paste the SAMPLE sheet URL.
- [ ] **Step 4:** Verify on production: `Sync now` reads the SAMPLE sheet. Create a test docket → the row appears at the top of SAMPLE, the PDF is in Drive `Contempra Dockets/2026/`, and column P has the link. Cancel it, delete it, restore it.
