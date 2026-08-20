// Implements: ADR-0098 (reference codes are minted and stored, never derived)
// `make db backfill-reference-codes` -- the manual operational step run between migration 0051
// (add the nullable reference_code columns) and the follow-up that makes them NOT NULL, so that
// follow-up only ever runs against an already-populated table. Safe to re-run: it only touches
// rows whose code is still null.
import { runReferenceCodeBackfill } from '../services/reference-code-backfill';

runReferenceCodeBackfill()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
