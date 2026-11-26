# Plan: My List + docket notes

Spec: `docs/superpowers/specs/2026-11-26-my-list-and-notes-design.md`.

1. Migration `0014_my_list_and_notes.sql`: `docket_follows`, `task_cards.work_order`, partial index.
2. Worker tests first (`test/worker/myList.test.ts`): follow/unfollow, `list=1` filter (sections, counts, history), `followed`/`myOpenNotes` per viewer, linked notes rules (self only, staff 403, unknown WO 404), `GET ?workOrder=`.
3. Worker: `listDockets`/`getDocket` take `viewerId` + `followed` filter; follow routes; task card `workOrder`.
4. Web tests first (`test/web/myList.test.tsx`): scope `My List` sends `list=1`; bookmark toggles with PUT/DELETE and labels; note button opens dialog with `To: Me` and sends `workOrder`; yellow mark with count; detail shows notes with Done; My Cards tile shows `#WO` and opens the docket.
5. Web: `DocketMarks` (FollowButton, NoteButton), tile restructure (stretched open button), Dashboard scope, DocketDetail header + notes, NewTaskCardDialog `workOrder`, TaskTile/TaskView/History `#WO`.
6. Full suite, typecheck, build, local migration, preview at 375 px, fresh reviewer, CLAUDE.md.
