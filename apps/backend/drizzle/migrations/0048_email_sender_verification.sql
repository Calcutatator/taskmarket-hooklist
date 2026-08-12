-- Records what, if anything, authenticated the sender of an inbound email.
--
-- Inbound mail is accepted from any unauthenticated internet sender and the `From:` header is
-- taken at face value, so `from_address` has never been an identity claim anyone verified. It
-- was surfaced beside verified fields with nothing distinguishing the two.
--
-- Existing rows get 'unverified' rather than NULL: they were received before anything was
-- checked, and "we did not check" is the honest verdict for them. NULL would read as "unknown",
-- which invites a consumer to treat it as maybe-fine.
ALTER TABLE "emails" ADD COLUMN IF NOT EXISTS "sender_verification" text DEFAULT 'unverified' NOT NULL;
