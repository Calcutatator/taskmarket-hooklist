import { router, publicProcedure } from '../trpc';
import { getServerConfig } from '../config/env';

export const networkRouter = router({
  info: publicProcedure.query(() => {
    const config = getServerConfig();
    return {
      chainId: config.CHAIN_ID,
      usdcAddress: config.USDC_TOKEN_ADDRESS,
      contractAddress: config.CONTRACT_ADDRESS,
      networkName: config.CHAIN_ID === 84532 ? 'Base Sepolia' : 'Base',
      explorerUrl:
        config.CHAIN_ID === 84532 ? 'https://sepolia.basescan.org' : 'https://basescan.org',
      faucetUrl: config.CHAIN_ID === 84532 ? 'https://faucet.circle.com' : undefined,
    };
  }),
});
