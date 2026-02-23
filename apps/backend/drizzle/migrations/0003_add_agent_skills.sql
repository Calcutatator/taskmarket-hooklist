ALTER TABLE agents ADD COLUMN IF NOT EXISTS skills text[] NOT NULL DEFAULT '{}';

-- Backfill skills from tags of tasks each agent completed as worker
UPDATE agents a
SET skills = ARRAY(
  SELECT DISTINCT unnest(t.tags)
  FROM tasks t
  WHERE t.worker = a.address
    AND t.status = 'accepted'
)
WHERE EXISTS (
  SELECT 1 FROM tasks t WHERE t.worker = a.address AND t.status = 'accepted'
);
