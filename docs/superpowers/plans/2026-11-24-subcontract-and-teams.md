# Plan: Sub Contract area and Installer teams

Spec: `docs/superpowers/specs/2026-11-24-subcontract-and-teams-design.md`. TDD for each step; whole suite + typecheck at the end.

1. **Migration 0011**: role `subcontract` (sort 11) given to admins/managers; tables `teams`, `team_members`; `cards.team_id`; seed Team A / Team B.
2. **Shared rules** (`src/shared/cards.ts`): `subcontract` in ROLE_ORDER, labels, AREA_TOKEN, CARD_FIELDS; generic required-text blocker.
3. **Colors**: `--area-subcontract` / `-ink` tokens (light + dark) in `src/web/index.css`; area legend test.
4. **Sheet v7** (`sheetSync.ts`): header, AREA_COLS + AB, Assigned AC, Photos AD, setup reads/clears Q–AD; bump version.
5. **Hand-off targets** (`src/shared/handoff.ts`): `teamId` targets; sender level check for Sub Contract.
6. **Worker hand-off** (`cards/handoff.ts`): load teams, give one card to all members with `team_id`; parked reuse by team.
7. **Claim lock** (`cards/actions.ts`): team card claimed by someone else → 409; only the claimer (or admin/manager) can act.
8. **DTO**: `teamName` on CardDTO; sheet K / Assigned / tracking use the team name.
9. **Teams API** (`routes/teams.ts`): GET for all, POST/PUT/DELETE admin.
10. **Web**: HandoffPicker "Teams" group (value `team:<id>`), Sub Contract hidden for Staff; card shows team; Admin → Teams section.
11. CLAUDE.md, review, suite, typecheck, preview at 375 px.
