-- Mirror of the Contempra sheet tab (columns A–P), one row per docket.
CREATE TABLE dockets (
  work_order TEXT PRIMARY KEY,
  sheet_row INTEGER NOT NULL,
  date_iso TEXT,
  date_raw TEXT,
  due_iso TEXT,
  due_raw TEXT,
  due_rush INTEGER NOT NULL DEFAULT 0,
  comp INTEGER NOT NULL,
  hold INTEGER NOT NULL,
  seq TEXT,
  customer TEXT,
  project TEXT,
  address TEXT,
  account_manager TEXT,
  role_note TEXT,
  inv INTEGER NOT NULL,
  inv_date_raw TEXT,
  quote_po TEXT,
  notes TEXT,
  link TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'on_hold', 'completed', 'cancelled')),
  billing TEXT NOT NULL CHECK (billing IN ('billed', 'no_charge', 'not_billed', 'cancelled')),
  row_hash TEXT NOT NULL,
  synced_at TEXT NOT NULL
);
CREATE INDEX idx_dockets_status_due ON dockets (status, due_iso);
CREATE INDEX idx_dockets_billing ON dockets (billing);
CREATE INDEX idx_dockets_am ON dockets (account_manager);

CREATE TABLE review_items (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('duplicate_work_order', 'invalid_work_order')),
  work_order TEXT,
  sheet_row INTEGER NOT NULL,
  raw_json TEXT NOT NULL,
  detected_at TEXT NOT NULL
);

CREATE TABLE sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_run_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  rows_seen INTEGER NOT NULL DEFAULT 0,
  rows_changed INTEGER NOT NULL DEFAULT 0,
  rows_deleted INTEGER NOT NULL DEFAULT 0
);
INSERT INTO sync_state (id) VALUES (1);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name TEXT NOT NULL,
  access_level TEXT NOT NULL CHECK (access_level IN ('admin', 'manager', 'staff')),
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  sort INTEGER NOT NULL
);
INSERT INTO roles (id, label, sort) VALUES
  ('designer', 'Designer', 1),
  ('printer_roll', 'Printer Roll', 2),
  ('printer_fb', 'Printer FB', 3),
  ('laminate_roll', 'Laminate Roll', 4),
  ('liquid_lam', 'Liquid Lam', 5),
  ('colex_finish', 'Colex Finish', 6),
  ('finishing', 'Finishing / Packaging', 7);

CREATE TABLE user_roles (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles (id),
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions (user_id);

CREATE TABLE login_attempts (
  username TEXT NOT NULL COLLATE NOCASE,
  attempted_at TEXT NOT NULL
);
CREATE INDEX idx_login_attempts ON login_attempts (username, attempted_at);
