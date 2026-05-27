import { Command } from 'commander';
import { x402Post } from '../../lib/x402.js';
import { printResult, printError } from '../../lib/output.js';

/**
 * Parse a --winner spec of the form
 *   <address>:<share>[:<submissionId>][:<deliverable>]
 *
 * Examples:
 *   0xAbCd...beef:5000
 *   0xAbCd...beef:5000:abcd-1234-...
 *   0xAbCd...beef:5000::0xdeadbeef...   (skip submissionId, pass deliverable)
 */
type Winner = {
  worker: string;
  share: number;
  submissionId?: string;
  deliverable?: string;
};

function parseWinner(spec: string): Winner {
  const parts = spec.split(':');
  if (parts.length < 2 || parts.length > 4) {
    throw new Error(
      `Invalid --winner value "${spec}". Expected <addr>:<share>[:<submissionId>][:<deliverable>]`
    );
  }
  const [worker, shareStr, submissionId, deliverable] = parts;
  if (!/^0x[0-9a-fA-F]{40}$/.test(worker)) {
    throw new Error(`Invalid worker address in "${spec}"`);
  }
  const share = parseInt(shareStr, 10);
  if (Number.isNaN(share) || share < 1 || share > 10000) {
    throw new Error(`Invalid share in "${spec}" — must be integer 1..10000 (basis points)`);
  }
  if (deliverable && !/^0x[0-9a-fA-F]{64}$/.test(deliverable)) {
    throw new Error(`Invalid deliverable hash in "${spec}" — must be 0x + 64 hex chars`);
  }
  return {
    worker,
    share,
    ...(submissionId ? { submissionId } : {}),
    ...(deliverable ? { deliverable } : {}),
  };
}

export const acceptSubmissionsCmd = new Command('accept-submissions')
  .description(
    'Accept N submissions for a Bounty/Benchmark task with explicit share basis points (costs 0.001 USDC).\n' +
      "Shares must sum to 10000. The backend resolves each winner's deliverable from the submission row\n" +
      'if --winner omits the explicit hash.\n\n' +
      'For ranked payouts, pass winners in rank order — workers[0] is the primary winner.\n\n' +
      'Examples:\n' +
      '  task accept-submissions 0x… --winner 0xAlice:5000 --winner 0xBob:3000 --winner 0xCarol:2000\n' +
      '  task accept-submissions 0x… --winner 0xAlice:5000:sub-uuid --winner 0xBob:5000:sub-uuid2'
  )
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .requiredOption(
    '--winner <spec...>',
    'Winner spec <addr>:<share>[:<submissionId>][:<deliverable>]. Pass multiple times.'
  )
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
