-- Hand-to-hand flow: each card belongs to one person, who handed it over and what to do.

-- Cards for people without an area, and the creator's card. Never given to users.
INSERT INTO roles (id, label, sort) VALUES ('general', 'General', 99);

ALTER TABLE cards ADD COLUMN instruction TEXT;
ALTER TABLE cards ADD COLUMN from_user_id INTEGER REFERENCES users (id);
ALTER TABLE cards ADD COLUMN from_card_id INTEGER;
-- Creator's card only: ready_to_close | waiting_design | waiting_sample.
ALTER TABLE cards ADD COLUMN stage TEXT;
-- 1 = hand-off card; 0 = card of an old fixed route.
ALTER TABLE cards ADD COLUMN handoff INTEGER NOT NULL DEFAULT 0;

-- card_events gets the new actions (SQLite cannot change a CHECK in place).
CREATE TABLE card_events_new (
  id INTEGER PRIMARY KEY,
  card_id INTEGER NOT NULL,
  role_id TEXT NOT NULL,
  work_order TEXT NOT NULL REFERENCES virtual_dockets (work_order) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('activated', 'claimed', 'field', 'continued', 'sent_back', 'completed', 'removed',
    'done', 'proof_sent', 'sample_sent', 'approved', 'closed', 'restored')),
  detail_json TEXT NOT NULL DEFAULT '{}',
  user_id INTEGER REFERENCES users (id),
  at TEXT NOT NULL
);
INSERT INTO card_events_new (id, card_id, role_id, work_order, action, detail_json, user_id, at)
  SELECT id, card_id, role_id, work_order, action, detail_json, user_id, at FROM card_events;
DROP TABLE card_events;
ALTER TABLE card_events_new RENAME TO card_events;
CREATE INDEX idx_card_events_wo ON card_events (work_order, at);
CREATE INDEX idx_card_events_card ON card_events (card_id);
