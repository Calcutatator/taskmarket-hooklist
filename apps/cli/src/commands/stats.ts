import { Command } from 'commander';
import { loadKeystore } from '../lib/keystore.js';
import { apiGet } from '../lib/api.js';
import { printResult } from '../lib/output.js';
import { formatDreams, dreamsToUsd, formatUsdcBaseUnits } from '@taskmarket/shared';

export const statsCommand = new Command('stats')
  .description('View agent statistics')
  .option('--address <addr>', 'Wallet address (defaults to own wallet)')
  .option('--agent <agentId>', 'Agent ID (alternative to --address)')
  .action(async (opts: { address?: string; agent?: string }) => {
    let address = opts.address;
    if (!address) {
      const keystore = await loadKeystore();
      address = keystore.walletAddress;
    }

    const statsQuery = opts.agent
      ? `/api/agents/stats?agentId=${opts.agent}`
      : `/api/agents/stats?address=${address}`;

    const [result, balanceResult, dreamsResult, exchangeRateResult] = await Promise.all([
      apiGet(statsQuery) as Promise<{
        agentId: string | null;
        address: string;
        completedTasks: number;
        ratedTasks: number;
        averageRating: number | null;
        credibility: number;
        totalEarnings: string;
        skills: string[];
        emailAddress: string | null;
        recentRatings: Array<{ rating: number; feedbackText: string | null; createdAt: string }>;
      }>,
      apiGet(`/api/wallet/balance?address=${address}`) as Promise<{
        balanceBaseUnits: string;
        balanceUsdc: string;
      }>,
      apiGet(`/api/wallet/dreams-balance?address=${address}`)
        .then((r) => r as { claimableBaseUnits: string })
        .catch(() => null),
      apiGet('/api/wallet/exchange-rate')
        .then((r) => r as { dreamsPerUsdc: string })
        .catch(() => null),
    ]);

    let pendingDreamsRewards: string | null = null;
    let pendingDreamsUsd: string | null = null;
    if (dreamsResult !== null) {
      pendingDreamsRewards = formatDreams(dreamsResult.claimableBaseUnits);
      if (exchangeRateResult !== null && exchangeRateResult.dreamsPerUsdc !== '0') {
        const usdBaseUnits = dreamsToUsd(
          dreamsResult.claimableBaseUnits,
          exchangeRateResult.dreamsPerUsdc
        );
        pendingDreamsUsd = formatUsdcBaseUnits(usdBaseUnits);
      }
    }
    const dreamsPerUsdc =
      exchangeRateResult !== null && exchangeRateResult.dreamsPerUsdc !== '0'
        ? exchangeRateResult.dreamsPerUsdc
        : null;

    printResult({
      agentId: result.agentId,
      address: result.address,
      balanceUsdc: balanceResult.balanceUsdc,
      balanceBaseUnits: balanceResult.balanceBaseUnits,
      pendingDreamsRewards,
      pendingDreamsUsd,
      dreamsPerUsdc,
      completedTasks: result.completedTasks,
      ratedTasks: result.ratedTasks,
      averageRating: result.averageRating,
      credibility: result.credibility,
      totalEarnings: result.totalEarnings,
      skills: result.skills,
      emailAddress: result.emailAddress,
      recentRatings: result.recentRatings,
    });
  });
