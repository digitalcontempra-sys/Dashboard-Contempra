-- Sub Contract: work sent out to another shop. Last area (General stays at 99).
INSERT INTO roles (id, label, sort) VALUES ('subcontract', 'Sub Contract', 11);

-- Approved by the owner on 2026-11-24: every admin and manager.
INSERT OR IGNORE INTO user_roles (user_id, role_id)
  SELECT id, 'subcontract' FROM users WHERE access_level IN ('admin', 'manager') AND active = 1;

-- Installer crews: "Send to Team B" gives one card to all its members; the first to start it takes it.
CREATE TABLE teams (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  role_id TEXT NOT NULL DEFAULT 'installer' REFERENCES roles (id),
  created_at TEXT NOT NULL
);

CREATE TABLE team_members (
  team_id INTEGER NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  PRIMARY KEY (team_id, user_id)
);

-- The team a card was sent to (its members are copied into assignee_ids when it is sent).
ALTER TABLE cards ADD COLUMN team_id INTEGER REFERENCES teams (id) ON DELETE SET NULL;

INSERT INTO teams (name, created_at) VALUES ('Team A', datetime('now')), ('Team B', datetime('now'));
INSERT OR IGNORE INTO team_members (team_id, user_id)
  SELECT t.id, u.id FROM teams t JOIN users u ON u.username = 'george.i' WHERE t.name = 'Team A';
INSERT OR IGNORE INTO team_members (team_id, user_id)
  SELECT t.id, u.id FROM teams t JOIN users u ON u.username IN ('gary', 'dennis') WHERE t.name = 'Team B';
