-- Free-plan sync: a rotating page cursor for partial reads and the last nightly reconcile.
ALTER TABLE sync_state ADD COLUMN page_cursor INTEGER;
ALTER TABLE sync_state ADD COLUMN last_full_at TEXT;
