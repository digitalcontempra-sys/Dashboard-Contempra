-- Measure: someone goes to the site to take measurements. Last area (General stays at 99).
INSERT INTO roles (id, label, sort) VALUES ('measure', 'Measure', 10);

-- People approved by the owner on 2026-11-24.
INSERT OR IGNORE INTO user_roles (user_id, role_id)
  SELECT id, 'measure' FROM users WHERE username IN ('jeff.w', 'kharash', 'gary', 'dennis', 'larry', 'nick', 'Cory');
