import { getServerWallet } from './rpc-gateway';

// Implements: ADR-0019
// The server wallet signs on-chain calls for many concurrent requests (task creation,
// identity registration, accept/rate/cancel, evaluator actions, etc.), all from this one
// address. Without a nonce manager, each concurrent call independently reads the current
// pending nonce and multiple calls can read the same value, so only one lands and the rest
// fail with "Nonce provided for the transaction is lower than the current nonce of the
// account" -- reproduced by firing off a handful of concurrent device registrations, which
// each trigger a background identity-registration call sharing this wallet. nonceManager
// serializes nonce allocation per (address, chainId). The RPC gateway also reuses the
// same account and wallet client across every call in this process.
export function createServerWallet() {
  return getServerWallet();
}
