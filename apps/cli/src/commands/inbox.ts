import { Command } from 'commander';
import { buildInboxSelfAuthMessage, buildMyBidsMessage } from '@taskmarket/shared';
import { apiGet } from '../lib/api.js';
import { createWalletAccountFromKeystore } from '../lib/signer.js';
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

    // Both self-auth checks (ADR-0015, ADR-0017) sign off the same locally
    // decrypted account, so the device key is only fetched from the key
    // server once per run rather than once per signature.
    let account: Awaited<ReturnType<typeof createWalletAccountFromKeystore>> | undefined;
    try {
      account = await createWalletAccountFromKeystore(keystore);
    } catch {
      // Non-fatal: both signatures fall back to unsigned, public-only views.
    }

    // Proves ownership of `address` so the inbox response also includes this
    // wallet's own unlisted tasks (ADR-0015), and so "my bids" (which has no
    // public view) can be scoped to this address (ADR-0017). Neither
    // signature depends on the other, so sign both concurrently.
    const [signature, bidsSignature] = await Promise.all([
      account?.signMessage({ message: buildInboxSelfAuthMessage(address) }).catch(() => undefined),
      account?.signMessage({ message: buildMyBidsMessage(address) }).catch(() => undefined),
    ]);

    const inboxParams = new URLSearchParams({ address });
    if (signature) inboxParams.set('signature', signature);

    const bidParams = new URLSearchParams({ address });
    if (bidsSignature) bidParams.set('signature', bidsSignature);

    // Independent endpoints -- fetch both concurrently. A missing or failed
    // my-bids signature/fetch is non-fatal and just yields an empty list.
    const [taskResult, pendingBids] = await Promise.all([
      apiGet(`/api/agents/inbox?${inboxParams.toString()}`) as Promise<InboxResult>,
      bidsSignature
        ? (apiGet(`/api/bids/my?${bidParams.toString()}`) as Promise<PendingBid[]>).catch(
            () => [] as PendingBid[]
          )
        : Promise.resolve([] as PendingBid[]),
    ]);

    printResult({ ...taskResult, pendingBids });
  });
