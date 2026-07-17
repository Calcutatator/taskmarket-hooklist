import { runConfiguredTaskAwardsBackfill } from '../src/services/configured-task-awards-backfill';

runConfiguredTaskAwardsBackfill()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
