import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { nonceManager } from 'viem/nonce';
import { base, baseSepolia } from 'viem/chains';
import { getServerConfig } from '../config/env';

// The server wallet signs on-chain calls for many concurrent requests (task creation,
// identity registration, accept/rate/cancel, evaluator actions, etc.), all from this one
// address. Without a nonce manager, each concurrent call independently reads the current
// pending nonce and multiple calls can read the same value, so only one lands and the rest
// fail with "Nonce provided for the transaction is lower than the current nonce of the
// account" -- reproduced by firing off a handful of concurrent device registrations, which
// each trigger a background identity-registration call sharing this wallet. nonceManager
// serializes nonce allocation per (address, chainId) across every createServerWallet() call
// in this process, not just within a single call.
export function createServerWallet() {
  const config = getServerConfig();
  const account = privateKeyToAccount(config.SERVER_PRIVATE_KEY as `0x${string}`, {
    nonceManager,
  });
  const chain = config.CHAIN_ID === 84532 ? baseSepolia : base;
  const client = createWalletClient({ account, chain, transport: http(config.BASE_RPC_URL) });
  return { client, account, address: account.address };
}
