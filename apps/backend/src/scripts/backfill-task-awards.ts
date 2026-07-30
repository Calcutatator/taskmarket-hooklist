// Implements: ADR-0008 (task_awards migration ships in two deploys)
// `make db backfill-task-awards` -- the manual operational step run between the 0027
// (create task_awards) and 0028 (drop tasks.worker/rating) deploys, so 0028's
// completedWithoutAwards guard only ever runs against an already-populated table.
import { runConfiguredTaskAwardsBackfill } from '../services/configured-task-awards-backfill';

runConfiguredTaskAwardsBackfill()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
