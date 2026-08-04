import { Command } from 'commander';
import { getWalletAddress } from '../lib/signer.js';
import { printResult, renderFailure } from '../lib/output.js';
import { apiGet } from '../lib/api.js';

type NetworkInfo = {
  chainId: number;
  usdcAddress: string;
  contractAddress: string;
  networkName: string;
  explorerUrl: string;
};

export const depositCommand = new Command('deposit')
  .description('Show wallet address and network info for funding')
  .action(async () => {
    let address: string;
    try {
      address = await getWalletAddress();
    } catch (err: unknown) {
      renderFailure(err, { fallback: 'No keystore found. Run `taskmarket init` first.' });
      return;
    }

    let networkInfo: NetworkInfo;
    try {
      const response = (await apiGet('/trpc/network.info')) as {
        result: { data: NetworkInfo };
      };
      networkInfo = response.result.data;
    } catch (err: unknown) {
      renderFailure(err, { fallback: 'Failed to fetch network info from backend.' });
      return;
    }

    const data = {
      address: address!,
      network: networkInfo!.networkName,
      chainId: networkInfo!.chainId,
      currency: 'USDC',
      usdcContract: networkInfo!.usdcAddress,
    };

    printResult(data);
  });
