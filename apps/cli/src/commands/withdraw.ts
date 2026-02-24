import { Command } from 'commander';
import { toHex } from 'viem';
import { loadKeystore } from '../lib/keystore.js';
import { signTypedData } from '../lib/signer.js';
import { apiGet, apiPost } from '../lib/api.js';
import { isHumanMode, printResult, printError } from '../lib/output.js';

interface WithdrawalAddressResponse {
  withdrawalAddress: string | null;
  usdcDomain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
  };
}

interface WithdrawResponse {
  txHash: string;
  amountBaseUnits: string;
  to: string;
}

const USDC_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

export const withdrawCommand = new Command('withdraw')
  .description('Withdraw USDC to the registered withdrawal address')
  .argument('<amount>', 'Amount in USDC (e.g. 5 for 5 USDC)')
  .option('--human', 'Human-readable output')
  .action(async (amount: string, opts: { human?: boolean }) => {
    const human = isHumanMode(opts.human);

    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) {
      printError('Invalid amount: must be a positive number (e.g. 5 for 5 USDC)', human);
    }
    const amountBaseUnits = String(Math.round(parsed * 1_000_000));

    let keystore: Awaited<ReturnType<typeof loadKeystore>>;
    try {
      keystore = await loadKeystore();
    } catch {
      printError('No keystore found. Run `taskmarket init` first.', human);
    }

    const from = keystore.walletAddress;

    const addressResponse = (await apiGet(
      `/api/wallet/withdrawal-address?address=${from}`
    )) as WithdrawalAddressResponse;

    if (!addressResponse.withdrawalAddress) {
      printError(
        'No withdrawal address set. Run: taskmarket wallet set-withdrawal-address <address>',
        human
      );
    }

    const { withdrawalAddress, usdcDomain } = addressResponse;

    const now = Math.floor(Date.now() / 1000);
    const authorization = {
      from,
      to: withdrawalAddress,
      value: amountBaseUnits,
      validAfter: String(now - 60),
      validBefore: String(now + 300),
      nonce: toHex(crypto.getRandomValues(new Uint8Array(32))),
    };

    const signature = await signTypedData(
      {
        domain: usdcDomain as Record<string, unknown>,
        types: USDC_TYPES as Record<string, unknown>,
        primaryType: 'TransferWithAuthorization',
        message: authorization as Record<string, unknown>,
      },
      keystore
    );

    const result = (await apiPost('/api/wallet/withdraw', {
      from,
      amountBaseUnits,
      authorization,
      signature,
    })) as WithdrawResponse;

    if (human) {
      const usdcAmount = (parseInt(result.amountBaseUnits) / 1_000_000).toFixed(6);
      console.log(`Withdrew ${usdcAmount} USDC to ${result.to}`);
      console.log('Transaction hash:', result.txHash);
    } else {
      printResult(
        { txHash: result.txHash, amountBaseUnits: result.amountBaseUnits, to: result.to },
        human
      );
    }
  });
