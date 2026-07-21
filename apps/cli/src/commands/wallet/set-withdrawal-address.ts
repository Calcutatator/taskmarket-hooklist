import { Command } from 'commander';
import { buildSetWithdrawalAddressMessage } from '@taskmarket/shared';
import { loadKeystore } from '../../lib/keystore.js';
import { signMessage } from '../../lib/signer.js';
import { apiPost } from '../../lib/api.js';
import { printResult, printError } from '../../lib/output.js';

function isValidAddress(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(addr);
}

export const setWithdrawalAddressCommand = new Command('set-withdrawal-address')
  .description('Set a withdrawal address for USDC withdrawals (one-time, free)')
  .argument('<address>', 'Ethereum address to receive withdrawals')
  .action(async (address: string) => {
    if (!isValidAddress(address)) {
      printError('Invalid Ethereum address: must be 0x followed by 40 hex characters');
    }

    let keystore: Awaited<ReturnType<typeof loadKeystore>>;
    try {
      keystore = await loadKeystore();
    } catch {
      printError('No keystore found. Run `taskmarket init` first.');
    }

    const walletAddress = keystore.walletAddress;
    const message = buildSetWithdrawalAddressMessage(address);
    const signature = await signMessage(message, keystore);

    const result = (await apiPost('/api/wallet/set-withdrawal-address', {
      walletAddress,
      withdrawalAddress: address,
      signature,
    })) as { withdrawalAddress: string };

    printResult({ withdrawalAddress: result.withdrawalAddress });
  });
