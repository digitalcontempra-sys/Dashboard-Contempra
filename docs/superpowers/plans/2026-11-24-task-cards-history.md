# Task Cards History + Note to self: implementation plan

**Spec:** `docs/superpowers/specs/2026-11-24-task-cards-history-design.md`

## Task 1: worker (`src/worker/routes/taskCards.ts`, `test/worker/taskCards.test.ts`)
- Test: a note to self is created with `isNew: false`, does not raise `newTasks`/`newCount`; Done gives `doneTasks: 0`; it is missing from `box=sent`.
- Test: `box=history` lists done tasks sent and received, newest `done_at` first, 50 per page, `hasMore`.
- Implement: drop the "yourself" check; insert `seen_at` for self; on Done set `done_seen_at` for self; `box=sent` adds `from_user <> to_user`; `box=history` with `page`.
- Types: `TaskHistoryPage = { items: TaskCardDTO[]; hasMore: boolean }` in `src/shared/types.ts`.

## Task 2: web (`src/web/tasks/*`, `src/web/pages/MyCards.tsx`, `test/web/taskCards.test.tsx`)
- Test: picker shows `Me (<name>)` first; picking it shows `Save`, posts own id, shows `Note saved`.
- Test: a self task tile reads `Note to self`; its view has `Delete`.
- Test: History tab lists rows with `Sent by me` / `Sent to me` / `Note to self`, `Show more` fetches page 2.
- Implement: `HistoryList` in `TaskCards.tsx` (useInfiniteQuery, key `["tasks","history"]`); `isSelf(t)` helper.

## Task 3: verify
- `npx vitest run`, `npm run typecheck`, preview at 375 px (no horizontal scroll).
