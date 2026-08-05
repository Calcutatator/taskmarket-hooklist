import { Command } from 'commander';
import { apiGet } from '../../lib/api.js';
import { signReadAuth } from '../../lib/read-auth.js';
import { printResult, renderFailure } from '../../lib/output.js';

export const mySubmissionsCmd = new Command('my-submissions')
  .description('List all submissions made by your wallet across all tasks.')
  .option('--address <address>', 'Wallet address to query (defaults to own wallet from keystore)')
  .action(async (opts: { address?: string }) => {
    try {
      // Proves ownership of the signing wallet's own address (Phase 2
      // read-auth, ADR-0016) so a non-public submissionVisibility task's
      // requester/submitting-worker sees everything they're entitled to,
      // instead of the anonymous view. Non-fatal if there's no keystore/wallet
      // yet -- falls back to whatever the anonymous view already reveals, same
      // as before this existed.
      const auth = await signReadAuth();
      const address = opts.address ?? auth?.walletAddress;

      if (!address) {
        throw new Error('No address provided and no keystore found -- pass --address <address>.');
      }

      const result = await apiGet(
        `/api/submissions/mine?workerAddress=${encodeURIComponent(address)}`,
        { headers: auth?.headers ?? {} }
      );
      printResult(result as Record<string, unknown>);
    } catch (err) {
      renderFailure(err);
    }
  });
