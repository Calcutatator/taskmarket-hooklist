ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS hook_contract         text,
  ADD COLUMN IF NOT EXISTS evaluator             text,
  ADD COLUMN IF NOT EXISTS evaluator_stake       numeric(78,0),
  ADD COLUMN IF NOT EXISTS evaluator_fee_bps     smallint,
  ADD COLUMN IF NOT EXISTS evaluation_window     integer,
  ADD COLUMN IF NOT EXISTS appeal_window         integer,
  ADD COLUMN IF NOT EXISTS dispute_resolver      text,
  ADD COLUMN IF NOT EXISTS appeal_deadline       timestamptz,
  ADD COLUMN IF NOT EXISTS verdict_type          text,
  ADD COLUMN IF NOT EXISTS verdict_score         smallint,
  ADD COLUMN IF NOT EXISTS verdict_confidence    smallint,
  ADD COLUMN IF NOT EXISTS verdict_evidence_hash text,
  ADD COLUMN IF NOT EXISTS evaluator_deadline    timestamptz;
