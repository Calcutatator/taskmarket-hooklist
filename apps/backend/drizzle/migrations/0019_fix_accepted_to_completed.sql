-- Re-run the accepted→completed fix for any rows written after migration 0018
-- was first applied. The acceptance router no longer writes 'accepted' so
-- this is the final cleanup.
UPDATE "tasks" SET "status" = 'completed' WHERE "status" = 'accepted';
