ALTER TABLE tasks ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
