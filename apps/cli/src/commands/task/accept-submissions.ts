import { Command } from 'commander';
import { x402Post } from '../../lib/x402.js';
import { printResult, printError } from '../../lib/output.js';

/**
 * Parse a --winner spec of the form <address>:<share>
 *
 * Example:
 *   0xAbCd...beef:5000
 */
type Winner = {
  worker: string;
  share: number;
};

function parseWinner(spec: string): Winner {
  const parts = spec.split(':');
  if (parts.length !== 2) {
    throw new Error(`Invalid --winner value "${spec}". Expected <addr>:<share>`);
  }
  const [worker, shareStr] = parts;
  if (!/^0x[0-9a-fA-F]{40}$/.test(worker)) {
    throw new Error(`Invalid worker address in "${spec}"`);
  }
  const share = parseInt(shareStr, 10);
  if (Number.isNaN(share) || share < 1 || share > 10000) {
    throw new Error(`Invalid share in "${spec}" — must be integer 1..10000 (basis points)`);
  }
  return { worker, share };
}

export const acceptSubmissionsCmd = new Command('accept-submissions')
  .description(
    'Accept N submissions for a Bounty/Benchmark task with explicit share basis points (costs 0.001 USDC).\n' +
      'Shares must sum to 10000. The contract resolves each deliverable from on-chain submission history.\n\n' +
      'For ranked payouts, pass winners in rank order — workers[0] is the primary winner.\n\n' +
      'Example:\n' +
      '  task accept-submissions 0x… --winner 0xAlice:5000 --winner 0xBob:3000 --winner 0xCarol:2000'
  )
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .requiredOption('--winner <spec...>', 'Winner spec <addr>:<share>. Pass multiple times.')
  .action(async (taskId: string, opts: { winner: string[] }) => {
    let winners: Winner[];
    try {
      winners = opts.winner.map(parseWinner);
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
      return;
    }
    const sum = winners.reduce((a, w) => a + w.share, 0);
    if (sum !== 10000) {
      printError(`Winner shares must sum to 10000 basis points (got ${sum})`);
      return;
    }

    const result = (await x402Post(`/api/tasks/${taskId}/accept-submissions`, {
      taskId,
      winners,
    })) as { success: boolean };

    printResult({ accepted: result.success, winners: winners.length });
  });
