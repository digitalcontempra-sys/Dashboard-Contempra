# My Dockets: plan

Spec: `docs/superpowers/specs/2026-11-26-my-dockets-design.md`. TDD en cada paso; suite completa al final.

1. **Migration 0013** `user_codes` + seed by username. Test: schema + seed in `test/worker/myDockets.test.ts`.
2. **Codes service** `src/worker/users/codes.ts`: `normalizeCodes`, `userCodes(db, id)`, `codeStatements`. Users routes accept/return `codes`; 409 on a code owned by someone else. `/auth/me` returns `codes`.
3. **Docket create/update**: create stamps the primary code (400 without codes); update keeps the baseline salesperson.
4. **List**: `listDockets` `codes?: string[]` filter; route `mine=1`.
5. **Web**: `SessionUser.codes`; DocketPaper salesperson read-only (no datalist); DocketEditor stamps code / blocks save; AdminUsers Initials field + chips; Dashboard scope selector with localStorage.
6. Docs (CLAUDE.md), review, typecheck, preview at 375 px.
