-- Production cards: one card per step of each job's route.

-- Roles: Colex and Finishing are separate activities; add Installer.
INSERT INTO roles (id, label, sort) VALUES ('colex', 'Colex', 6);
UPDATE user_roles SET role_id = 'colex' WHERE role_id = 'colex_finish';
UPDATE job_steps SET role_id = 'colex' WHERE role_id = 'colex_finish';
DELETE FROM roles WHERE id = 'colex_finish';
INSERT INTO roles (id, label, sort) VALUES ('installer', 'Installer', 8);

-- Cards are keyed by job position (docket_jobs rows are re-created on every save).
CREATE TABLE cards (
  id INTEGER PRIMARY KEY,
  work_order TEXT NOT NULL REFERENCES virtual_dockets (work_order) ON DELETE CASCADE,
  job_sort INTEGER NOT NULL,
  job_name TEXT NOT NULL,
  step INTEGER NOT NULL,
  role_id TEXT NOT NULL REFERENCES roles (id),
  assignee_ids TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('waiting', 'active', 'done')),
  claimed_by INTEGER REFERENCES users (id),
  fields_json TEXT NOT NULL DEFAULT '{}',
  returned_reason TEXT,
  returned_by INTEGER REFERENCES users (id),
  version INTEGER NOT NULL DEFAULT 0,
  activated_at TEXT,
  done_at TEXT,
  done_by INTEGER REFERENCES users (id),
  updated_at TEXT NOT NULL,
  UNIQUE (work_order, job_sort, step)
);
CREATE INDEX idx_cards_role_status ON cards (role_id, status);
CREATE INDEX idx_cards_wo ON cards (work_order);

CREATE TABLE card_events (
  id INTEGER PRIMARY KEY,
  card_id INTEGER NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
  work_order TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('activated', 'claimed', 'field', 'continued', 'sent_back', 'completed', 'removed')),
  detail_json TEXT NOT NULL DEFAULT '{}',
  user_id INTEGER REFERENCES users (id),
  at TEXT NOT NULL
);
CREATE INDEX idx_card_events_wo ON card_events (work_order, at);

CREATE TABLE card_seen (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  card_id INTEGER NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
  seen_at TEXT NOT NULL,
  PRIMARY KEY (user_id, card_id)
);

-- Dockets whose Q–Z / Production tab must be rewritten. hold/comp: NULL = no change.
CREATE TABLE card_sheet_queue (
  work_order TEXT PRIMARY KEY,
  hold INTEGER,
  comp INTEGER,
  queued_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

ALTER TABLE users ADD COLUMN sound_on INTEGER NOT NULL DEFAULT 1;
