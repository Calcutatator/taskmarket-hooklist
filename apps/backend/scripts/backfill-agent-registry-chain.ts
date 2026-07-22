import { runAgentRegistryChainBackfill } from '../src/services/agent-registry-chain-backfill';

const dryRun = process.argv.includes('--dry-run');

runAgentRegistryChainBackfill({ dryRun })
  .then((summary) => {
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
