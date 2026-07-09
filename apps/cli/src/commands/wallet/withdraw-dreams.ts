import { Command } from 'commander';
import { loadKeystore } from '../../lib/keystore.js';
import { signMessage } from '../../lib/signer.js';
import { apiGet, apiPost } from '../../lib/api.js';
import { printResult, printError } from '../../lib/output.js';
import { formatDreams } from '@taskmarket/shared';

function isValidAddress(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(addr);
}

interface WithdrawalAddressResponse {
  withdrawalAddress: string | null;
}

interface WithdrawDreamsResponse {
  txHash: string;
  destination: string;
  claimedBaseUnits: string;
  dreamsPerUsdc: string;
  usdEquivalent: string;
}

export const withdrawDreamsCommand = new Command('withdraw-dreams')
  .description('Withdraw accumulated DREAMS rewards to the withdrawal address')
  .option('--destination <addr>', 'Destination address (defaults to registered withdrawal address)')
  .action(async (opts: { destination?: string }) => {
    let keystore: Awaited<ReturnType<typeof loadKeystore>>;
    try {
      keystore = await loadKeystore();
    } catch {
      printError('No keystore found. Run `taskmarket init` first.');
    }

    const workerAddress = keystore.walletAddress;

    let destination = opts.destination;
    if (destination !== undefined && !isValidAddress(destination)) {
      printError('Invalid Ethereum address: must be 0x followed by 40 hex characters');
    }

    if (!destination) {
      const addressResponse = (await apiGet(
        `/api/wallet/withdrawal-address?address=${workerAddress}`
      )) as WithdrawalAddressResponse;

      if (!addressResponse.withdrawalAddress) {
        printError(
          'No withdrawal address set. Run: taskmarket wallet set-withdrawal-address <address>'
        );
      }
      destination = addressResponse.withdrawalAddress!;
    }

    const message = `taskmarket:withdraw-dreams:${destination}`;
    const signature = await signMessage(message, keystore);

    const result = (await apiPost('/api/wallet/withdraw-dreams', {
      workerAddress,
      destination,
      signature,
    })) as WithdrawDreamsResponse;

    printResult({
      txHash: result.txHash,
      destination: result.destination,
      claimedBaseUnits: result.claimedBaseUnits,
      claimedDreams: formatDreams(result.claimedBaseUnits),
      dreamsPerUsdc: result.dreamsPerUsdc,
      usdEquivalent: result.usdEquivalent,
    });
  });
