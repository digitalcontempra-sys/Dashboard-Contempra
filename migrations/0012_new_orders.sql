-- New Orders: a docket saved with only the customer and a note, waiting for more info.
-- Cleared when the docket is handed to people.
ALTER TABLE virtual_dockets ADD COLUMN new_order INTEGER NOT NULL DEFAULT 0;
