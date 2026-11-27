-- D1 free plan: keep rows read per day low (spec 2026-11-27-d1-rows-read-design.md).
-- D1 counts every index entry and every table row it visits. These indexes cover the columns the
-- dashboard needs to count sections and pick a page, so those steps never touch the table rows.

-- All dockets of a view (status = ...): sections, counts and page order.
DROP INDEX IF EXISTS idx_dockets_status_due;
CREATE INDEX idx_dockets_status_cover ON dockets (status, due_iso, due_rush, date_iso, work_order);

-- Newest first (All, New Orders, No Due Date): the page walks this index in order and stops after a page.
CREATE INDEX idx_dockets_status_date ON dockets (status, date_iso, CAST(work_order AS INTEGER), work_order, due_iso, due_rush);

-- My Dockets, At risk and the account-manager filter: account_manager = / IN (...) AND status = ...,
-- in the same newest-first order.
DROP INDEX IF EXISTS idx_dockets_am;
CREATE INDEX idx_dockets_am_cover ON dockets (account_manager, status, date_iso, CAST(work_order AS INTEGER), work_order, due_iso, due_rush);

-- History (newest work order first): the page walks this index instead of sorting every closed docket.
CREATE INDEX idx_dockets_wo_num ON dockets (CAST(work_order AS INTEGER));

-- Open cards per area (header).
CREATE INDEX idx_cards_status_role ON cards (status, role_id);

-- Incremental sync: hash of each block of 50 work orders (WO / 50) as last written to D1. A block
-- that hashes the same is skipped without reading its dockets.
CREATE TABLE sync_blocks (
  block INTEGER PRIMARY KEY,
  hash TEXT NOT NULL
);
-- A docket deleted from D1 (Trash, nightly reconcile, by hand) must be looked up again.
CREATE TRIGGER dockets_delete_forgets_blocks AFTER DELETE ON dockets BEGIN
  DELETE FROM sync_blocks;
END;

-- Polling: one counter that every change to what the polled views read bumps. The list and the
-- summaries answer 304 (one row read) while it has not moved since the client's ETag.
CREATE TABLE data_version (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  v INTEGER NOT NULL
);
INSERT INTO data_version (id, v) VALUES (1, 0);

CREATE TRIGGER data_version_dockets_insert AFTER INSERT ON dockets BEGIN UPDATE data_version SET v = v + 1 WHERE id = 1; END;
CREATE TRIGGER data_version_dockets_update AFTER UPDATE ON dockets BEGIN UPDATE data_version SET v = v + 1 WHERE id = 1; END;
CREATE TRIGGER data_version_dockets_delete AFTER DELETE ON dockets BEGIN UPDATE data_version SET v = v + 1 WHERE id = 1; END;
CREATE TRIGGER data_version_virtual_dockets_insert AFTER INSERT ON virtual_dockets BEGIN UPDATE data_version SET v = v + 1 WHERE id = 1; END;
CREATE TRIGGER data_version_virtual_dockets_update AFTER UPDATE ON virtual_dockets BEGIN UPDATE data_version SET v = v + 1 WHERE id = 1; END;
CREATE TRIGGER data_version_virtual_dockets_delete AFTER DELETE ON virtual_dockets BEGIN UPDATE data_version SET v = v + 1 WHERE id = 1; END;
CREATE TRIGGER data_version_task_cards_insert AFTER INSERT ON task_cards BEGIN UPDATE data_version SET v = v + 1 WHERE id = 1; END;
CREATE TRIGGER data_version_task_cards_update AFTER UPDATE ON task_cards BEGIN UPDATE data_version SET v = v + 1 WHERE id = 1; END;
CREATE TRIGGER data_version_task_cards_delete AFTER DELETE ON task_cards BEGIN UPDATE data_version SET v = v + 1 WHERE id = 1; END;
CREATE TRIGGER data_version_docket_follows_insert AFTER INSERT ON docket_follows BEGIN UPDATE data_version SET v = v + 1 WHERE id = 1; END;
CREATE TRIGGER data_version_docket_follows_update AFTER UPDATE ON docket_follows BEGIN UPDATE data_version SET v = v + 1 WHERE id = 1; END;
CREATE TRIGGER data_version_docket_follows_delete AFTER DELETE ON docket_follows BEGIN UPDATE data_version SET v = v + 1 WHERE id = 1; END;
CREATE TRIGGER data_version_users_insert AFTER INSERT ON users BEGIN UPDATE data_version SET v = v + 1 WHERE id = 1; END;
CREATE TRIGGER data_version_users_update AFTER UPDATE ON users BEGIN UPDATE data_version SET v = v + 1 WHERE id = 1; END;
CREATE TRIGGER data_version_users_delete AFTER DELETE ON users BEGIN UPDATE data_version SET v = v + 1 WHERE id = 1; END;
CREATE TRIGGER data_version_user_codes_insert AFTER INSERT ON user_codes BEGIN UPDATE data_version SET v = v + 1 WHERE id = 1; END;
CREATE TRIGGER data_version_user_codes_update AFTER UPDATE ON user_codes BEGIN UPDATE data_version SET v = v + 1 WHERE id = 1; END;
CREATE TRIGGER data_version_user_codes_delete AFTER DELETE ON user_codes BEGIN UPDATE data_version SET v = v + 1 WHERE id = 1; END;
CREATE TRIGGER data_version_user_roles_insert AFTER INSERT ON user_roles BEGIN UPDATE data_version SET v = v + 1 WHERE id = 1; END;
CREATE TRIGGER data_version_user_roles_update AFTER UPDATE ON user_roles BEGIN UPDATE data_version SET v = v + 1 WHERE id = 1; END;
CREATE TRIGGER data_version_user_roles_delete AFTER DELETE ON user_roles BEGIN UPDATE data_version SET v = v + 1 WHERE id = 1; END;
CREATE TRIGGER data_version_card_seen_insert AFTER INSERT ON card_seen BEGIN UPDATE data_version SET v = v + 1 WHERE id = 1; END;
CREATE TRIGGER data_version_card_seen_update AFTER UPDATE ON card_seen BEGIN UPDATE data_version SET v = v + 1 WHERE id = 1; END;
CREATE TRIGGER data_version_card_seen_delete AFTER DELETE ON card_seen BEGIN UPDATE data_version SET v = v + 1 WHERE id = 1; END;

-- Cards: field saves (debounced while people type) only bump it for the fields a tile shows.
CREATE TRIGGER data_version_cards_insert AFTER INSERT ON cards BEGIN UPDATE data_version SET v = v + 1 WHERE id = 1; END;
CREATE TRIGGER data_version_cards_delete AFTER DELETE ON cards BEGIN UPDATE data_version SET v = v + 1 WHERE id = 1; END;
CREATE TRIGGER data_version_cards_update AFTER UPDATE ON cards
WHEN OLD.work_order IS NOT NEW.work_order
  OR OLD.job_sort IS NOT NEW.job_sort
  OR OLD.job_name IS NOT NEW.job_name
  OR OLD.step IS NOT NEW.step
  OR OLD.role_id IS NOT NEW.role_id
  OR OLD.assignee_ids IS NOT NEW.assignee_ids
  OR OLD.status IS NOT NEW.status
  OR OLD.claimed_by IS NOT NEW.claimed_by
  OR OLD.returned_reason IS NOT NEW.returned_reason
  OR OLD.returned_by IS NOT NEW.returned_by
  OR OLD.activated_at IS NOT NEW.activated_at
  OR OLD.done_at IS NOT NEW.done_at
  OR OLD.done_by IS NOT NEW.done_by
  OR OLD.instruction IS NOT NEW.instruction
  OR OLD.from_user_id IS NOT NEW.from_user_id
  OR OLD.from_card_id IS NOT NEW.from_card_id
  OR OLD.stage IS NOT NEW.stage
  OR OLD.handoff IS NOT NEW.handoff
  OR OLD.team_id IS NOT NEW.team_id
  OR json_extract(OLD.fields_json, '$.vendorPickup') IS NOT json_extract(NEW.fields_json, '$.vendorPickup')
  OR json_extract(OLD.fields_json, '$.packaged') IS NOT json_extract(NEW.fields_json, '$.packaged')
BEGIN UPDATE data_version SET v = v + 1 WHERE id = 1; END;
