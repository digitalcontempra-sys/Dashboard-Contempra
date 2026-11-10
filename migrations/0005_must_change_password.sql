-- Accounts created by the staff import (or reset by an admin) must set their own password at first sign-in.
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
