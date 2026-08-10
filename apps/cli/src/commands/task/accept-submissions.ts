import { Command } from 'commander';
import { x402Post } from '../../lib/x402.js';
import { printResult, renderFailure } from '../../lib/output.js';

/**
 * Parse a --winner spec of the form <address>:<share> or <address>:<share>:<submissionId>
 *
 * The optional submissionId pins a specific submission version by DB id.
 * Without it the contract auto-resolves the worker's latest on-chain submission.
 *
 * Examples:
 *   0xAlice:5000
 *   0xAlice:5000:sub_abc123
 */
type Winner = {
  worker: string;
  share: number;
  submissionId?: string;
};

function parseWinner(spec: string): Winner {
  const parts = spec.split(':');
  if (parts.length < 2 || parts.length > 3) {
    throw new Error(
      `Invalid --winner value "${spec}". Expected <addr>:<share> or <addr>:<share>:<submissionId>`
    );
  }
  const [worker, shareStr, submissionIdStr] = parts;
  if (!/^0x[0-9a-fA-F]{40}$/.test(worker)) {
    throw new Error(`Invalid worker address in "${spec}"`);
  }
  const share = parseInt(shareStr, 10);
  if (Number.isNaN(share) || share < 1 || share > 10000) {
    throw new Error(`Invalid share in "${spec}" — must be integer 1..10000 (basis points)`);
  }
  const submissionId = submissionIdStr ? submissionIdStr : undefined;
  return { worker, share, ...(submissionId !== undefined && { submissionId }) };
}

export const acceptSubmissionsCmd = new Command('accept-submissions')
  .description(
    'Accept N submissions for a Bounty/Benchmark task with explicit share basis points (costs 0.001 USDC).\n' +
      'Shares must sum to 10000. The contract resolves each deliverable from on-chain submission history.\n\n' +
      'For ranked payouts, pass winners in rank order — workers[0] is the primary winner.\n\n' +
      'To pin a specific submission version, append the submission ID as a third field.\n\n' +
      'Examples:\n' +
      '  task accept-submissions 0x… --winner 0xAlice:5000 --winner 0xBob:3000 --winner 0xCarol:2000\n' +
      '  task accept-submissions 0x… --winner 0xAlice:5000:sub_abc123 --winner 0xBob:5000:sub_def456'
  )
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .requiredOption(
    '--winner <spec...>',
    'Winner spec <addr>:<share> or <addr>:<share>:<submissionId>. Pass multiple times.'
  )
  .action(async (taskId: string, opts: { winner: string[] }) => {
    try {
      const winners = opts.winner.map(parseWinner);
      const sum = winners.reduce((a, w) => a + w.share, 0);
      if (sum !== 10000) {
        throw new Error(`Winner shares must sum to 10000 basis points (got ${sum})`);
      }
      const { data: result, idempotencyKey } = await x402Post<{ success: boolean }>(
        `/api/tasks/${taskId}/accept-submissions`,
        {
          taskId,
          winners,
        }
      );
      printResult({ accepted: result.success, winners: winners.length }, { idempotencyKey });
    } catch (err) {
      // Covers both the locally thrown spec errors above and the paid write. A local `Error`
      // renders with no envelope, exactly as it always did; the write's `ApiError` renders with
      // the `reason` and `pending` a script needs before deciding whether to run this again.
      renderFailure(err);
    }
  });
