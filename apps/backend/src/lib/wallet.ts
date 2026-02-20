import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';
import { getServerConfig } from '../config/env';

export function createServerWallet() {
  const config = getServerConfig();
  const account = privateKeyToAccount(config.SERVER_PRIVATE_KEY as `0x${string}`);
  const chain = config.CHAIN_ID === 84532 ? baseSepolia : base;
  const client = createWalletClient({ account, chain, transport: http(config.BASE_RPC_URL) });
  return { client, account, address: account.address };
}
