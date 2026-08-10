-- Record the gas each server-wallet transaction attempt was actually broadcast with (ADR-0051).
--
-- Replacement gas escalates from the fee being replaced, not from a fresh oracle reading, so
-- every attempt has to know what the previous attempt paid. Without that the second
-- replacement on a flat oracle is priced identically to the first, which providers reject as
-- an insufficient bump -- the reconciler then loops forever without ever putting a new
-- transaction on the network. The original fee is kept separately because the cap is a
-- multiple of it and must not move as attempts escalate.
ALTER TABLE "server_wallet_transactions" ADD COLUMN IF NOT EXISTS "original_max_fee_per_gas" numeric(78, 0);--> statement-breakpoint
ALTER TABLE "server_wallet_transactions" ADD COLUMN IF NOT EXISTS "original_max_priority_fee_per_gas" numeric(78, 0);--> statement-breakpoint
ALTER TABLE "server_wallet_transactions" ADD COLUMN IF NOT EXISTS "last_max_fee_per_gas" numeric(78, 0);--> statement-breakpoint
ALTER TABLE "server_wallet_transactions" ADD COLUMN IF NOT EXISTS "last_max_priority_fee_per_gas" numeric(78, 0);--> statement-breakpoint
-- Durably mark a row whose current tx_hash is a replacement rather than the original work
-- (ADR-0045). The association was in process memory only, so a restart between broadcasting a
-- replacement and reading its receipt left the intent behind it unsettled: a fresh process
-- could not tell a no-op self-transfer's receipt from the real call's, and a confirmed
-- replacement is one of only two forms of evidence permitted to settle an intent as failed.
ALTER TABLE "server_wallet_transactions" ADD COLUMN IF NOT EXISTS "replaced_tx_hash" text;
