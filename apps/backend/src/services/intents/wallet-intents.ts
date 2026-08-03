// Implements: ADR-0045, ADR-0050
import { eq } from 'drizzle-orm';

import type { db as DbType } from '../../db/client';
import { dreamsWithdrawNonces } from '../../db/schema';
import { contractTransferWithAuthorization, contractWithdrawDreamsRewards } from '../contract';

type Db = typeof DbType;

export type WalletWithdrawIntentPayload = {
  amountBaseUnits: string;
  from: string;
  nonce: string;
  signature: string;
  to: string;
  validAfter: string;
  validBefore: string;
};

export type WalletWithdrawDreamsIntentPayload = {
  destination: string;
  nonce: string;
  workerAddress: string;
};

/**
 * Replay the user's EIP-3009 authorization exactly as they signed it.
 *
 * Nothing here is recomputed, least of all `validBefore`. The authorization is the user's
 * signed statement of what may happen and until when; amending it to keep a retry alive would
 * be putting words in their mouth. A replay that arrives after the window has closed reverts,
 * the intent fails terminally, no funds move, and the user signs a fresh authorization -- the
 * same thing a wallet does with a stale transaction.
 */
export function broadcastWalletWithdraw(context: {
  payload: WalletWithdrawIntentPayload;
}): Promise<`0x${string}`> {
  const { payload } = context;
  return contractTransferWithAuthorization(
    payload.from as `0x${string}`,
    payload.to as `0x${string}`,
    BigInt(payload.amountBaseUnits),
    BigInt(payload.validAfter),
    BigInt(payload.validBefore),
    payload.nonce as `0x${string}`,
    payload.signature
  );
}

/**
 * Deliberately empty, for the same reason acceptance.acceptSubmissions is.
 *
 * A USDC withdrawal has no off-chain half: the transfer, its replay protection and its
 * accounting are all the token contract's, and this backend keeps no ledger of it. The intent
 * still earns its place -- it is the durable record that this relay was attempted, which is
 * what lets a lost broadcast be retried instead of silently disappearing. Inventing a write
 * here to fill the shape would be worse than saying there isn't one.
 */
export async function completeWalletWithdraw(): Promise<void> {}

export function broadcastWalletWithdrawDreams(context: {
  payload: WalletWithdrawDreamsIntentPayload;
}): Promise<`0x${string}`> {
  const { payload } = context;
  return contractWithdrawDreamsRewards(
    payload.workerAddress as `0x${string}`,
    payload.destination as `0x${string}`
  );
}

/**
 * Also empty: the DREAMS hook holds the claimable balance and zeroes it on withdrawal, so the
 * only database row involved is the replay nonce, and that has to be claimed before the chain
 * call rather than after (see releaseWalletWithdrawDreamsNonce).
 */
export async function completeWalletWithdrawDreams(): Promise<void> {}

/**
 * Hand back the replay nonce when nothing reached the chain.
 *
 * The nonce claim is the one piece of durable state that genuinely cannot move into the
 * completion handler. `withdrawFor` is executed by the backend wallet rather than as a user
 * transaction, so the contract has no replay protection of its own to lean on: the database
 * insert *is* the guard, and it has to win the race before the call is made, or two concurrent
 * requests carrying the same captured signature both broadcast.
 *
 * Claiming first leaves the opposite risk -- a nonce burned for a withdrawal that never
 * happened, locking the user out of an authorization they legitimately still hold. Releasing
 * it here closes that, and only here: this runs solely on the path where the broadcast
 * provably never reached the chain. A receipt timeout does not come through here, because a
 * timed-out transaction may still be mined and its nonce must stay spent.
 */
export async function releaseWalletWithdrawDreamsNonce(context: {
  db: Db;
  nonce: string;
}): Promise<void> {
  await context.db
    .delete(dreamsWithdrawNonces)
    .where(eq(dreamsWithdrawNonces.nonce, context.nonce));
}
