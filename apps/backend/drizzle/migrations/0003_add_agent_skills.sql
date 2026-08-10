ALTER TABLE agents ADD COLUMN IF NOT EXISTS skills text[] NOT NULL DEFAULT '{}';

-- Backfill skills from tags of tasks each agent completed as worker
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tasks' AND column_name = 'worker'
  ) THEN
    EXECUTE $backfill$
UPDATE agents a
SET skills = ARRAY(
  SELECT DISTINCT unnest(t.tags)
  FROM tasks t
  WHERE t.worker = a.address
    AND t.status = 'accepted'
)
WHERE EXISTS (
  SELECT 1 FROM tasks t WHERE t.worker = a.address AND t.status = 'accepted'
);$backfill$;
  END IF;
END $$;
