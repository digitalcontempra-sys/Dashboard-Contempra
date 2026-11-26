-- My List: dockets a user follows. Personal; nothing else changes on the docket.
CREATE TABLE docket_follows (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_order TEXT NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (user_id, work_order)
) WITHOUT ROWID;

-- A note to self can be pinned to a docket.
ALTER TABLE task_cards ADD COLUMN work_order TEXT;
CREATE INDEX idx_task_cards_docket ON task_cards (to_user, work_order, status) WHERE work_order IS NOT NULL;
