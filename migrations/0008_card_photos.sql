-- Installer photos: the full image lives in Google Drive (one folder per docket), a small thumbnail in R2.
CREATE TABLE card_photos (
  id INTEGER PRIMARY KEY,
  card_id INTEGER NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
  work_order TEXT NOT NULL,
  drive_file_id TEXT NOT NULL,
  link TEXT NOT NULL,
  name TEXT NOT NULL,
  uploaded_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_card_photos_card ON card_photos (card_id);
CREATE INDEX idx_card_photos_wo ON card_photos (work_order);

CREATE TABLE docket_photo_folders (
  work_order TEXT PRIMARY KEY,
  folder_id TEXT NOT NULL,
  link TEXT NOT NULL
);
