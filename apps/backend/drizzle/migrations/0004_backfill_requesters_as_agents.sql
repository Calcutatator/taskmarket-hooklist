-- Backfill: any wallet that has ever created a task should appear in the agent directory
INSERT INTO agents (address)
SELECT DISTINCT requester
FROM tasks
ON CONFLICT (address) DO NOTHING;
