ALTER TABLE tasks
  ADD COLUMN hook_contract         text,
  ADD COLUMN evaluator             text,
  ADD COLUMN evaluator_stake       numeric(78,0),
  ADD COLUMN evaluator_fee_bps     smallint,
  ADD COLUMN evaluation_window     integer,
  ADD COLUMN appeal_window         integer,
  ADD COLUMN dispute_resolver      text,
  ADD COLUMN appeal_deadline       timestamptz,
  ADD COLUMN verdict_type          text,
  ADD COLUMN verdict_score         smallint,
  ADD COLUMN verdict_confidence    smallint,
  ADD COLUMN verdict_evidence_hash text,
  ADD COLUMN evaluator_deadline    timestamptz;
