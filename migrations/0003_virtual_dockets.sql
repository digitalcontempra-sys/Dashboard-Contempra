-- Google OAuth connection of the sheet owner (single row).
CREATE TABLE google_connection (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  email TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  sheet_id TEXT,
  sheet_gid INTEGER,
  drive_folder_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('connected', 'disconnected')),
  connected_at TEXT NOT NULL,
  connected_by INTEGER
);

CREATE TABLE oauth_states (
  state TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

-- Full digital docket (the paper form) keyed by Work Order.
CREATE TABLE virtual_dockets (
  work_order TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('saving', 'saved')),
  form_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  pdf_key TEXT,
  drive_file_id TEXT,
  drive_link TEXT,
  drive_status TEXT NOT NULL DEFAULT 'none' CHECK (drive_status IN ('none', 'pending', 'syncing', 'done', 'failed')),
  drive_claimed_at TEXT,
  drive_attempts INTEGER NOT NULL DEFAULT 0,
  -- Docket version the stored PDF was rendered from, and a counter bumped on every PDF upload.
  pdf_version INTEGER,
  pdf_generation INTEGER NOT NULL DEFAULT 0,
  drive_generation INTEGER,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_by INTEGER,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  deleted_by INTEGER,
  deleted_row_json TEXT
);
CREATE INDEX idx_virtual_dockets_deleted ON virtual_dockets (deleted_at);
CREATE INDEX idx_virtual_dockets_drive ON virtual_dockets (drive_status);

-- Production routing chosen on the docket (consumed by the production cards spec).
CREATE TABLE docket_jobs (
  id INTEGER PRIMARY KEY,
  work_order TEXT NOT NULL REFERENCES virtual_dockets (work_order) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL
);
CREATE INDEX idx_docket_jobs_wo ON docket_jobs (work_order);

CREATE TABLE job_steps (
  job_id INTEGER NOT NULL REFERENCES docket_jobs (id) ON DELETE CASCADE,
  step INTEGER NOT NULL,
  role_id TEXT NOT NULL REFERENCES roles (id),
  assignee_ids TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (job_id, step)
);

-- Short leases that serialize the app's own Google writes (sheet rows shift when rows are inserted).
CREATE TABLE locks (
  name TEXT PRIMARY KEY,
  holder TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
