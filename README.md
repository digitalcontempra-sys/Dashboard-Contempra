# Dashboard Contempra

Production dashboard for Contempra, built on top of the "Workorder Books" Google Sheet.
Cloudflare Worker (Hono API + React SPA) with a D1 mirror of the sheet, synced every minute.

- Design spec: `docs/superpowers/specs/2026-10-19-dashboard-contempra-design.md`
- Phase 1 plan: `docs/superpowers/plans/2026-10-19-phase-1-foundation.md`

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Local app at http://localhost:5173 (Worker + SPA, local D1) |
| `npm test` | All tests (worker in workerd, web in jsdom) |
| `npm run typecheck` | TypeScript for worker and web |
| `npm run build` | Typecheck + production build |
| `npm run deploy` | Build and deploy to Cloudflare |

## Local development

1. `npm install`
2. Copy `.dev.vars.example` to `.dev.vars` (it sets `ENVIRONMENT=development`; deploys use `production` from `wrangler.jsonc`). Set a random `SETUP_TOKEN` and add
   `DEV_ADMIN_USER` / `DEV_ADMIN_PASSWORD` for your local admin. Never commit `.dev.vars`.
3. `npx wrangler d1 migrations apply dashboard-contempra --local`
4. `npm run dev`
5. Load real data from an Excel export of the sheet (stays on your machine, `fixtures/local/` is git-ignored):

   ```bash
   python -I scripts/xlsx_to_values.py "C:/path/Workorder Books.xlsx" fixtures/local/contempra-values.json
   node scripts/dev-setup.mjs
   ```

   `dev-setup.mjs` creates the first admin (only when no users exist) and imports the JSON through
   `POST /api/dev/import`, which only exists when `ENVIRONMENT=development`.

## Google Sheets access (production)

1. Google Cloud project → enable the **Google Sheets API**.
2. Create a service account and a JSON key.
3. Share the **backup** sheet with the service account email as **Viewer** (Phase 1 only reads).
4. Store secrets: `npx wrangler secret put GOOGLE_SA_JSON`, `SHEET_ID`, `SETUP_TOKEN`.

The sync reads `Contempra!A1:P`. If a header in A–P changes, sync stops with `Header mismatch: <column>`
and keeps the last good data. If the sheet suddenly returns fewer than half the rows, sync also stops.
