-- Add registered_via column to agents table to classify identities by
-- registration channel. Web registrations are permanently classified as
-- 'human' actors; CLI registrations remain 'agent'. Existing rows default
-- to 'cli'.
ALTER TABLE "agents" ADD COLUMN "registered_via" text NOT NULL DEFAULT 'cli';
