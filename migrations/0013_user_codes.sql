-- My Dockets: each user's codes in sheet column J (Account Manager). Upper case, no spaces.
-- A code belongs to one user only; sort 0 is the main code, stamped on dockets the user creates.
CREATE TABLE user_codes (
  code TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sort INTEGER NOT NULL
);
CREATE INDEX user_codes_user ON user_codes (user_id, sort);

-- Initial codes, by username (checked against production on 2026-11-26). CF and MN belong to nobody.
INSERT INTO user_codes (code, user_id, sort) SELECT 'AR', id, 0 FROM users WHERE username = 'ali' COLLATE NOCASE;
INSERT INTO user_codes (code, user_id, sort) SELECT 'ALI', id, 1 FROM users WHERE username = 'ali' COLLATE NOCASE;
INSERT INTO user_codes (code, user_id, sort) SELECT 'CB', id, 0 FROM users WHERE username = 'cory' COLLATE NOCASE;
INSERT INTO user_codes (code, user_id, sort) SELECT 'DA', id, 0 FROM users WHERE username = 'danni' COLLATE NOCASE;
INSERT INTO user_codes (code, user_id, sort) SELECT 'DB', id, 1 FROM users WHERE username = 'danni' COLLATE NOCASE;
INSERT INTO user_codes (code, user_id, sort) SELECT 'DL', id, 0 FROM users WHERE username = 'diane' COLLATE NOCASE;
INSERT INTO user_codes (code, user_id, sort) SELECT 'IS', id, 0 FROM users WHERE username = 'ira' COLLATE NOCASE;
INSERT INTO user_codes (code, user_id, sort) SELECT 'JB', id, 0 FROM users WHERE username = 'jeff.b' COLLATE NOCASE;
INSERT INTO user_codes (code, user_id, sort) SELECT 'JG', id, 0 FROM users WHERE username = 'justin' COLLATE NOCASE;
INSERT INTO user_codes (code, user_id, sort) SELECT 'KD', id, 0 FROM users WHERE username = 'kristy' COLLATE NOCASE;
INSERT INTO user_codes (code, user_id, sort) SELECT 'MB', id, 0 FROM users WHERE username = 'meinrad' COLLATE NOCASE;
