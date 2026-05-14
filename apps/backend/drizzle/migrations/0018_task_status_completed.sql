-- The terminal success state for a task is now 'completed', set by the indexer
-- when it processes the on-chain TaskAccepted event (payment confirmed).
-- Previously both the acceptance router and the indexer wrote 'accepted'.
-- The acceptance router continues to write 'accepted' as a transient state
-- immediately after submitting the on-chain transaction; the indexer upgrades
-- it to 'completed' once the event is processed.
-- Migrate all existing rows so historical tasks reflect the correct terminal state.
UPDATE "tasks" SET "status" = 'completed' WHERE "status" = 'accepted';
