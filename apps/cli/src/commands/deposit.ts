import { Command } from 'commander';
import { getWalletAddress } from '../lib/signer.js';
import { isHumanMode, printResult, printError } from '../lib/output.js';

const NETWORK = 'Base Sepolia';
const CHAIN_ID = 84532;
const USDC_CONTRACT = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const FAUCET = 'https://faucet.circle.com';

export const depositCommand = new Command('deposit')
  .description('Show wallet address and network info for funding')
  .option('--human', 'Human-readable output')
  .action(async (opts: { human?: boolean }) => {
    const human = isHumanMode(opts.human);

    let address: string;
    try {
      address = await getWalletAddress();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'No keystore found. Run `taskmarket init` first.';
      printError(msg, human);
    }

    const data = {
      address: address!,
      network: NETWORK,
      chainId: CHAIN_ID,
      currency: 'USDC',
      usdcContract: USDC_CONTRACT,
      faucet: FAUCET,
    };

    if (!human) {
      printResult(data, human);
      return;
    }

    console.log('\nFund your wallet to use Taskmarket');
    console.log('');
    console.log(`  Address:  ${data.address}`);
    console.log(`  Network:  ${data.network} (chain ID ${data.chainId})`);
    console.log(`  Currency: ${data.currency}`);
    console.log(`  Contract: ${data.usdcContract}`);
    console.log('');
    console.log('Get testnet USDC:');
    console.log(`  Faucet: ${data.faucet}`);
    console.log('  (select Base Sepolia, paste your address above)');
  });
