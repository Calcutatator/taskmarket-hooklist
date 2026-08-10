import { Command } from 'commander';
import { formatUsdcBaseUnits } from '@taskmarket/shared';
import { x402Post } from '../../lib/x402.js';
import { printResult, renderFailure } from '../../lib/output.js';
import { usdcToBaseUnits } from '../../lib/usdc.js';
import { withErrorContext } from '../../lib/api.js';

export const auctionAcceptCmd = new Command('auction-accept')
  .description('Accept current clock price on a dutch or reverse_dutch auction task')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .option(
    '--min-price <usdc>',
    'Reject if current clock price is below this value (price floor guard)'
  )
  .action(async (taskId: string, opts: { minPrice?: string }) => {
    const body: Record<string, unknown> = { taskId };
    if (opts.minPrice) {
      try {
        body.minPrice = usdcToBaseUnits(opts.minPrice, { allowZero: true });
      } catch (error) {
        renderFailure(withErrorContext(error, 'Invalid --min-price'));
        return;
      }
    }
    const { data: result, idempotencyKey } = await x402Post<{
      acceptedPrice: string;
      workerAddress: string;
    }>(`/api/tasks/${taskId}/bids/accept`, body);
    printResult(
      {
        acceptedPrice: result.acceptedPrice,
        acceptedPriceUsdc: formatUsdcBaseUnits(result.acceptedPrice),
        workerAddress: result.workerAddress,
      },
      { idempotencyKey }
    );
  });
