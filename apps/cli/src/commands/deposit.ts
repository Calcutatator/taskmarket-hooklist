import { Command } from 'commander';
import { getWalletAddress } from '../lib/signer.js';
import { isHumanMode, printResult, printError } from '../lib/output.js';
import { apiGet } from '../lib/api.js';

type NetworkInfo = {
  chainId: number;
  usdcAddress: string;
  contractAddress: string;
  networkName: string;
  explorerUrl: string;
  faucetUrl?: string;
};

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

    let networkInfo: NetworkInfo;
    try {
      const response = (await apiGet('/trpc/network.info')) as {
        result: { data: NetworkInfo };
      };
      networkInfo = response.result.data;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch network info from backend.';
      printError(msg, human);
    }

    const data = {
      address: address!,
      network: networkInfo!.networkName,
      chainId: networkInfo!.chainId,
      currency: 'USDC',
      usdcContract: networkInfo!.usdcAddress,
      faucetUrl: networkInfo!.faucetUrl,
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
    if (data.faucetUrl) {
      console.log('');
      console.log('Get testnet USDC:');
      console.log(`  Faucet: ${data.faucetUrl}`);
      console.log('  (select Base Sepolia, paste your address above)');
    }
  });
