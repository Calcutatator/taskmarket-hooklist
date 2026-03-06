import { Command } from 'commander';
import { apiGet } from '../lib/api.js';
import { getWalletAddress } from '../lib/signer.js';
import { loadKeystore } from '../lib/keystore.js';
import { printResult, printError } from '../lib/output.js';

interface TaskRow {
  id: string;
  description: string;
  reward: string;
  mode: string;
  status: string;
  tags: string[];
}

interface InboxResult {
  asRequester: TaskRow[];
  asWorker: TaskRow[];
}

interface PendingBid {
  taskId: string;
  auctionType: string | null;
  myBidPrice: string;
  currentLowestBid: string | null;
  bidDeadline: string | null;
  bidCount: number;
  taskStatus: string;
}

export const inboxCommand = new Command('inbox')
  .description('Show tasks you created and tasks you are working on')
  .action(async () => {
    let address: string;
    try {
      address = await getWalletAddress();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'No keystore found. Run `taskmarket init` first.';
      printError(msg);
    }

    const taskResult = (await apiGet(
      `/api/agents/inbox?address=${encodeURIComponent(address!)}`
    )) as InboxResult;

    // Fetch pending bids if device auth is available
    let pendingBids: PendingBid[] = [];
    try {
      const keystore = await loadKeystore();
      if (keystore.deviceId && keystore.apiToken) {
        const params = new URLSearchParams({
          deviceId: keystore.deviceId,
          apiToken: keystore.apiToken,
        });
        pendingBids = (await apiGet(`/api/bids/my?${params.toString()}`)) as PendingBid[];
      }
    } catch {
      // Non-fatal: include inbox tasks without pending bids
    }

    printResult({ ...taskResult, pendingBids });
  });
