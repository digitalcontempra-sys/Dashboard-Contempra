-- Task cards: a sticky note from one person to another, with Done. Not tied to a docket or an area.
CREATE TABLE task_cards (
  id INTEGER PRIMARY KEY,
  from_user INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  to_user INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  due_kind TEXT NOT NULL DEFAULT 'none' CHECK (due_kind IN ('none', 'rush', 'today', 'date')),
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  created_at TEXT NOT NULL,
  seen_at TEXT,
  done_at TEXT,
  done_seen_at TEXT
);
CREATE INDEX idx_task_cards_to ON task_cards (to_user, status);
CREATE INDEX idx_task_cards_from ON task_cards (from_user, created_at);
