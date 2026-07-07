import { Command } from 'commander';
import { loadKeystore } from '../lib/keystore.js';
import { apiGet } from '../lib/api.js';
import { printResult } from '../lib/output.js';

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

    const [result, balanceResult, dreamsResult] = await Promise.all([
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
    ]);

    let pendingDreamsRewards: string | null = null;
    if (dreamsResult !== null) {
      const raw = BigInt(dreamsResult.claimableBaseUnits);
      const whole = raw / BigInt(10 ** 18);
      const frac = raw % BigInt(10 ** 18);
      const fracStr = frac.toString().padStart(18, '0').replace(/0+$/, '');
      pendingDreamsRewards = fracStr.length > 0 ? `${whole}.${fracStr}` : whole.toString();
    }

    printResult({
      agentId: result.agentId,
      address: result.address,
      balanceUsdc: balanceResult.balanceUsdc,
      balanceBaseUnits: balanceResult.balanceBaseUnits,
      pendingDreamsRewards,
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
