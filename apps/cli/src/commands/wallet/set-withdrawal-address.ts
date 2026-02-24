import { Command } from 'commander';
import { loadKeystore } from '../../lib/keystore.js';
import { signMessage } from '../../lib/signer.js';
import { apiPost } from '../../lib/api.js';
import { isHumanMode, printResult, printError } from '../../lib/output.js';

function isValidAddress(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(addr);
}

export const setWithdrawalAddressCommand = new Command('set-withdrawal-address')
  .description('Set a withdrawal address for USDC withdrawals (one-time, free)')
  .argument('<address>', 'Ethereum address to receive withdrawals')
  .option('--human', 'Human-readable output')
  .action(async (address: string, opts: { human?: boolean }) => {
    const human = isHumanMode(opts.human);

    if (!isValidAddress(address)) {
      printError('Invalid Ethereum address: must be 0x followed by 40 hex characters', human);
    }

    let keystore: Awaited<ReturnType<typeof loadKeystore>>;
    try {
      keystore = await loadKeystore();
    } catch {
      printError('No keystore found. Run `taskmarket init` first.', human);
    }

    const walletAddress = keystore.walletAddress;
    const message = `taskmarket:set-withdrawal-address:${address}`;
    const signature = await signMessage(message, keystore);

    const result = (await apiPost('/api/wallet/set-withdrawal-address', {
      walletAddress,
      withdrawalAddress: address,
      signature,
    })) as { withdrawalAddress: string };

    if (human) {
      console.log('Withdrawal address set:', result.withdrawalAddress);
    } else {
      printResult({ withdrawalAddress: result.withdrawalAddress }, human);
    }
  });
