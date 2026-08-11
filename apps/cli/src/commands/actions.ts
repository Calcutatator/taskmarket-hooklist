import { Command } from 'commander';
import { apiGet } from '../lib/api.js';
import { signReadAuth } from '../lib/read-auth.js';
import { printResult, printError } from '../lib/output.js';

// Implements: ADR-0080 (the action queue is an agent-facing surface, not a web feature)
/**
 * Reads the server's action queue (ADR-0079, ADR-0080).
 *
 * This is deliberately not `inbox`. `taskmarket inbox` answers "which tasks am I in" over
 * `GET /api/agents/inbox`; this answers "what do I owe, and what is late". Two different
 * questions over two different endpoints, and naming both of them "inbox" is the confusion
 * ADR-0080 exists partly to end.
 *
 * It also does not derive anything. The queue's grouping, urgency, and suppression are applied
 * server-side in `action-queue.ts` -- `refund_expired` is withheld there while the pooled-escrow
 * vulnerability (issue #432) is unfixed. A client that rebuilt its own worklist from raw
 * `pendingActions` would not inherit that, which is why this command renders what the endpoint
 * returns rather than filtering it.
 */
interface ActionQueueResult {
  items: unknown[];
  total: number;
  urgentTotal: number;
  waiting: unknown[];
}

export const actionsCommand = new Command('actions')
  .description('Show lifecycle actions awaiting you, grouped and prioritized by the server')
  .action(async () => {
    // Self-auth unlocks the private and restricted tasks this wallet holds a role on; without
    // it the queue still answers, just only from what is publicly visible. Same read-auth
    // mechanism the inbox command uses (ADR-0023).
    const auth = await signReadAuth();
    if (!auth) {
      printError('No keystore found. Run `taskmarket init` first.');
      return;
    }

    const params = new URLSearchParams({ address: auth.walletAddress });

    const queue = (await apiGet(`/api/agents/action-queue?${params.toString()}`, {
      headers: auth.headers,
    })) as ActionQueueResult;

    printResult(queue);
  });
