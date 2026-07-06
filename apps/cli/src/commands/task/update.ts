import { Command } from 'commander';
import { x402Post } from '../../lib/x402.js';
import { apiGet } from '../../lib/api.js';
import { printResult, printError } from '../../lib/output.js';

function toBaseUnits(humanUsdc: string): string {
  const [intPart = '0', fracPart = ''] = humanUsdc.trim().split('.');
  const padded = fracPart.slice(0, 6).padEnd(6, '0');
  return (BigInt(intPart) * 1_000_000n + BigInt(padded)).toString();
}

export const updateCmd = new Command('update')
  .description('Update an open task (costs 0.001 USDC)')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .option('--reward <usdc>', 'New reward in USDC (human units, e.g. "50")')
  .option('--extend-expiry <seconds>', 'Extend expiry by this many seconds')
  .option('--bid-deadline <iso>', 'New bid deadline (ISO 8601)')
  .option('--pitch-deadline <iso>', 'New pitch deadline (ISO 8601)')
  .option('--auction-floor-price <usdc>', 'New auction floor price in USDC')
  .option('--auction-start-price <usdc>', 'New auction start price in USDC')
  .option('--description <text>', 'New description')
  .option('--tags <csv>', 'New tags (comma-separated)')
  .option('--metric-description <text>', 'New metric description')
  .action(
    async (
      taskId: string,
      opts: {
        reward?: string;
        extendExpiry?: string;
        bidDeadline?: string;
        pitchDeadline?: string;
        auctionFloorPrice?: string;
        auctionStartPrice?: string;
        description?: string;
        tags?: string;
        metricDescription?: string;
      }
    ) => {
      const body: Record<string, unknown> = { taskId };

      if (opts.reward !== undefined) {
        body.reward = toBaseUnits(opts.reward);
      }

      if (opts.extendExpiry !== undefined) {
        const delta = parseInt(opts.extendExpiry, 10);
        if (!Number.isFinite(delta) || delta < 1) {
          printError(
            `--extend-expiry must be a positive integer (seconds), got: ${opts.extendExpiry}`
          );
        }
        const task = (await apiGet(`/api/tasks/${taskId}`)) as Record<string, unknown> | null;
        if (!task) {
          printError(`Task not found: ${taskId}`);
        }
        const currentExpiry = Math.floor(new Date(task.expiryTime as string).getTime() / 1000);
        const newExpiry = currentExpiry + delta;
        const now = Math.floor(Date.now() / 1000);
        if (newExpiry <= now) {
          const expiredAgo = now - currentExpiry;
          printError(
            `--extend-expiry would set expiry in the past. Task expired ${expiredAgo}s ago; ` +
              `pass at least ${expiredAgo + 1} seconds to extend beyond now.`
          );
        }
        body.expiryTime = newExpiry;
      }

      if (opts.bidDeadline !== undefined) {
        const ts = Math.floor(new Date(opts.bidDeadline).getTime() / 1000);
        if (ts <= Math.floor(Date.now() / 1000)) {
          printError('--bid-deadline must be in the future');
        } else {
          body.bidDeadline = ts;
        }
      }

      if (opts.pitchDeadline !== undefined) {
        const ts = Math.floor(new Date(opts.pitchDeadline).getTime() / 1000);
        if (ts <= Math.floor(Date.now() / 1000)) {
          printError('--pitch-deadline must be in the future');
        } else {
          body.pitchDeadline = ts;
        }
      }

      if (opts.auctionFloorPrice !== undefined) {
        body.auctionFloorPrice = toBaseUnits(opts.auctionFloorPrice);
      }

      if (opts.auctionStartPrice !== undefined) {
        body.auctionStartPrice = toBaseUnits(opts.auctionStartPrice);
      }

      if (opts.description !== undefined) {
        body.description = opts.description;
      }

      if (opts.tags !== undefined) {
        body.tags = opts.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
      }

      if (opts.metricDescription !== undefined) {
        body.metricDescription = opts.metricDescription;
      }

      const result = await x402Post(`/api/tasks/${taskId}/update`, body);
      printResult(result as Record<string, unknown>);
    }
  );
