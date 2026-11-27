-- Incremental sync blocks (0015): any write to a docket forgets its block, so the next incremental
-- run compares that block with D1 again. Without this, a row written by a full sync or a dashboard
-- save, followed by the sheet going back to the old value, kept the stale row (the block hash matched).
-- The incremental sync stores its block hashes after its own docket writes, so it is not affected.
-- Block = work order / 50 (blockOf in src/worker/sync/incremental.ts); a non-numeric one forgets all.
CREATE TRIGGER dockets_insert_forgets_block AFTER INSERT ON dockets BEGIN
  DELETE FROM sync_blocks
  WHERE NEW.work_order GLOB '*[^0-9]*' OR NEW.work_order = ''
     OR block = CAST(NEW.work_order AS INTEGER) / 50;
END;
CREATE TRIGGER dockets_update_forgets_block AFTER UPDATE ON dockets BEGIN
  DELETE FROM sync_blocks
  WHERE NEW.work_order GLOB '*[^0-9]*' OR NEW.work_order = ''
     OR block = CAST(NEW.work_order AS INTEGER) / 50;
END;
