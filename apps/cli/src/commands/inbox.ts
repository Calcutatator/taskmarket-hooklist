import { Command } from 'commander';
import { apiGet } from '../lib/api.js';
import { signMessage } from '../lib/signer.js';
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
    let keystore: Awaited<ReturnType<typeof loadKeystore>>;
    try {
      keystore = await loadKeystore();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'No keystore found. Run `taskmarket init` first.';
      printError(msg);
    }

    const address = keystore.walletAddress;

    // Proves ownership of `address` so the response also includes this
    // wallet's own unlisted tasks (ADR-0015). A signing failure is non-fatal --
    // the inbox still loads, just without unlisted tasks, same as before.
    let signature: string | undefined;
    try {
      signature = await signMessage(`taskmarket:inbox:${address}`, keystore);
    } catch {
      // Non-fatal: fall back to the unauthenticated (public-only) view.
    }

    const inboxParams = new URLSearchParams({ address });
    if (signature) inboxParams.set('signature', signature);

    const taskResult = (await apiGet(`/api/agents/inbox?${inboxParams.toString()}`)) as InboxResult;

    // Fetch pending bids if device auth is available
    let pendingBids: PendingBid[] = [];
    try {
      if (keystore.deviceId && keystore.apiToken) {
        const bidParams = new URLSearchParams({ deviceId: keystore.deviceId });
        pendingBids = (await apiGet(`/api/bids/my?${bidParams.toString()}`, {
          headers: { 'x-taskmarket-api-token': keystore.apiToken },
        })) as PendingBid[];
      }
    } catch {
      // Non-fatal: include inbox tasks without pending bids
    }

    printResult({ ...taskResult, pendingBids });
  });
