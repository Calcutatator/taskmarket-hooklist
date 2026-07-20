CREATE TABLE IF NOT EXISTS "dreams_withdraw_nonces" (
  "nonce" text PRIMARY KEY,
  "used_at" timestamptz NOT NULL DEFAULT now()
);
