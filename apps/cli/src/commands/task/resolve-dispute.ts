import { Command } from 'commander';
import { x402Post } from '../../lib/x402.js';
import { printResult, printError, renderFailure } from '../../lib/output.js';
import { usdcToBaseUnits } from '../../lib/usdc.js';

/**
 * Parse an --award spec of the form
 *   <address>:<amount_usdc>:<rank>
 *
 * Amount is in USDC (e.g. "5" for 5 USDC), converted to base units (6 decimals).
 *
 * Example:
 *   0xAbCd...beef:5:1
 */
type Award = {
  worker: string;
  amount: string;
  rank: number;
};

function parseAward(spec: string): Award {
  const parts = spec.split(':');
  if (parts.length !== 3) {
    throw new Error(`Invalid --award value "${spec}". Expected <addr>:<amount_usdc>:<rank>`);
  }
  const [worker, amountStr, rankStr] = parts;
  if (!/^0x[0-9a-fA-F]{40}$/.test(worker)) {
    throw new Error(`Invalid worker address in "${spec}"`);
  }
  const amount = usdcToBaseUnits(amountStr);
  const rank = parseInt(rankStr, 10);
  if (!Number.isInteger(rank) || rank < 1) {
    throw new Error(`Invalid rank in "${spec}" — must be an integer >= 1`);
  }
  return {
    worker,
    amount,
    rank,
  };
}

export const resolveDisputeCmd = new Command('resolve-dispute')
  .description(
    'Resolve a disputed task as the designated dispute resolver (X402 required).\n\n' +
      'Examples:\n' +
      '  task resolve-dispute 0x… --verdict approve --award 0xAlice:5:1\n' +
      '  task resolve-dispute 0x… --verdict partial --award 0xAlice:3:1 --award 0xBob:2:2'
  )
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .requiredOption('--verdict <type>', 'Verdict type: approve or partial')
  .requiredOption(
    '--award <spec...>',
    'Award spec <addr>:<amount_usdc>:<rank>. Pass multiple times.'
  )
  .action(async (taskId: string, opts: { verdict: string; award: string[] }) => {
    if (opts.verdict !== 'approve' && opts.verdict !== 'partial') {
      printError('--verdict must be "approve" or "partial"');
      return;
    }

    let awards: Award[];
    try {
      awards = opts.award.map(parseAward);
    } catch (err) {
      renderFailure(err);
      return;
    }

    const result = (await x402Post(`/api/tasks/${taskId}/resolve-dispute`, {
      taskId,
      verdict: opts.verdict,
      awards,
    })) as { txHash: string };

    printResult({ txHash: result.txHash });
  });
