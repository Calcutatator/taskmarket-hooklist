import { Command } from 'commander';
import { apiGet } from '../lib/api.js';
import { signReadAuth } from '../lib/read-auth.js';
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
    // One read-auth signature (ADR-0016/ADR-0022) proves ownership of the
    // wallet for both requests below: it unlocks this wallet's own unlisted
    // tasks in the inbox response, and is required outright for my-bids
    // (which has no public view -- a failed/absent signature just skips it).
    const auth = await signReadAuth();
    if (!auth) {
      printError('No keystore found. Run `taskmarket init` first.');
      return;
    }

    const address = auth.walletAddress;
    const hasReadAuth = Object.keys(auth.headers).length > 0;

    const inboxParams = new URLSearchParams({ address });

    const [taskResult, pendingBids] = await Promise.all([
      apiGet(`/api/agents/inbox?${inboxParams.toString()}`, {
        headers: auth.headers,
      }) as Promise<InboxResult>,
      hasReadAuth
        ? (apiGet('/api/bids/my', { headers: auth.headers }) as Promise<PendingBid[]>).catch(
            () => [] as PendingBid[]
          )
        : Promise.resolve([] as PendingBid[]),
    ]);

    printResult({ ...taskResult, pendingBids });
  });
