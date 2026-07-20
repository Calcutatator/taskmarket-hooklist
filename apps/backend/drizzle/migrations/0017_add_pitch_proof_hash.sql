-- Pitch and proof submissions are now anchored on-chain via TaskMarket.submitPitch
-- and TaskMarket.submitProof. Each emits a PitchSubmitted / ProofSubmitted event
-- carrying a content hash that the backend writes here alongside the off-chain
-- text/data, so anyone can verify operator-served content matches what was
-- submitted on chain.
--
-- submit_tx_hash records the transaction that anchored the hash. Both columns
-- are nullable to preserve pre-v2 rows (no anchor exists for those).
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "pitch_hash" text;
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "submit_tx_hash" text;
ALTER TABLE "proofs" ADD COLUMN IF NOT EXISTS "proof_hash" text;
ALTER TABLE "proofs" ADD COLUMN IF NOT EXISTS "submit_tx_hash" text;
