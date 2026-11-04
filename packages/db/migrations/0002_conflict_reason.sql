-- Rejected offline changes (no permission, invalid transition) are recorded like conflicts,
-- so the user sees why a change made on the device did not take effect.
ALTER TABLE sync_conflict ADD COLUMN kind text NOT NULL DEFAULT 'conflict' CHECK (kind IN ('conflict', 'rejected'));
ALTER TABLE sync_conflict ADD COLUMN reason text;
ALTER TABLE sync_conflict ALTER COLUMN base_version DROP NOT NULL;
ALTER TABLE sync_conflict ALTER COLUMN server_version DROP NOT NULL;
ALTER TABLE sync_conflict ALTER COLUMN server_state DROP NOT NULL;
