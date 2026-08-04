// Implements: ADR-0040
import { and, asc, eq, exists, gt, lt, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { db } from '../db/client';
import { serverWalletNonces, serverWalletTransactions } from '../db/schema';

type Database = Pick<typeof db, 'transaction' | 'select' | 'update' | 'insert'>;

export type ServerTransactionStatus =
  | 'reserved'
  | 'broadcast'
  | 'confirmed'
  | 'recycled'
  | 'failed';

export type AllocatedNonce = { id: string; nonce: number };

// Implements: ADR-0051
/** The two mutable fields of a relayed write (ADR-0050 point 7). */
export type GasFees = { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };

/**
 * A row the reconciler may replace, carrying the gas history the next attempt escalates from.
 *
 * `originalFees` is null when the row was never broadcast with a recorded fee -- an abandoned
 * reservation, or a row written before the fee columns existed. `lastFees` is null until the
 * first broadcast. Both nulls fall back to the oracle-derived opening bid.
 */
export type ReplaceableRow = AllocatedNonce & {
  lastFees: GasFees | null;
  originalFees: GasFees | null;
};

export type PendingTransactionRow = ReplaceableRow & {
  broadcastAt: Date | null;
  /**
   * The hash `txHash` superseded, or null when `txHash` is still the original transaction.
   *
   * Durable, and that is the point: a receipt against a replacement means the work did not
   * happen, and a process that restarted since the replacement was broadcast has no other way
   * to know which of the two it is looking at (ADR-0045).
   */
  replacedTxHash: string | null;
  txHash: string | null;
};

/**
 * Persistence seam for the nonce allocator and transaction outbox.
 *
 * The dispatcher depends on this interface rather than on the database directly, which keeps
 * every database transaction inside one method call. Nothing here may perform an RPC call,
 * so no connection is ever held across network latency (ADR-0040).
 */
export type ServerTransactionStore = {
  /** Allocate the next nonce, preferring a recycled one. One short database transaction. */
  allocate(context: string | undefined): Promise<AllocatedNonce>;
  /** Rows still awaiting a receipt, oldest nonce first. */
  listBroadcast(limit: number): Promise<PendingTransactionRow[]>;
  /** Rows allocated but never broadcast, older than the cutoff -- an abandoned process. */
  listAbandonedReservations(cutoff: Date, limit: number): Promise<ReplaceableRow[]>;
  /**
   * Recycled rows older than the cutoff whose nonce sits below an in-flight transaction.
   *
   * A recycled nonce is normally harmless: the next allocation reuses it. It becomes a problem
   * when a higher nonce was already broadcast, because that transaction cannot mine until this
   * one is used, and on a quiet relayer no next allocation is coming.
   */
  listBlockingRecycled(cutoff: Date, limit: number): Promise<ReplaceableRow[]>;
  /** Seed the allocator from the supplied chain nonce if it has never been seeded. */
  seed(readPendingNonce: () => Promise<number>): Promise<void>;
  /**
   * Record a replacement broadcast against an already-allocated nonce, along with the gas it
   * went out with -- which is what the *next* escalation multiplies (ADR-0051) -- and the hash
   * it superseded, which is what tells a restarted process that this row's transaction is a
   * replacement (ADR-0045).
   */
  recordReplacement(
    id: string,
    hash: string,
    fields?: { fees?: GasFees; replacedTxHash?: string | null }
  ): Promise<void>;
  /** Move the allocator forward when the chain has advanced past it. */
  resync(readPendingNonce: () => Promise<number>): Promise<void>;
  setStatus(
    id: string,
    status: ServerTransactionStatus,
    fields?: { hash?: string; error?: unknown; fees?: GasFees }
  ): Promise<void>;
};

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

function toFees(row: {
  maxFeePerGas: string | null;
  maxPriorityFeePerGas: string | null;
}): GasFees | null {
  // Both or neither: a half-recorded pair is not a price anything was sent at.
  if (row.maxFeePerGas === null || row.maxPriorityFeePerGas === null) return null;
  return {
    maxFeePerGas: BigInt(row.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(row.maxPriorityFeePerGas),
  };
}

const feeColumns = {
  lastMaxFeePerGas: serverWalletTransactions.lastMaxFeePerGas,
  lastMaxPriorityFeePerGas: serverWalletTransactions.lastMaxPriorityFeePerGas,
  originalMaxFeePerGas: serverWalletTransactions.originalMaxFeePerGas,
  originalMaxPriorityFeePerGas: serverWalletTransactions.originalMaxPriorityFeePerGas,
};

type FeeColumnValues = {
  lastMaxFeePerGas: string | null;
  lastMaxPriorityFeePerGas: string | null;
  originalMaxFeePerGas: string | null;
  originalMaxPriorityFeePerGas: string | null;
};

function splitFees(row: FeeColumnValues): Pick<ReplaceableRow, 'lastFees' | 'originalFees'> {
  return {
    lastFees: toFees({
      maxFeePerGas: row.lastMaxFeePerGas,
      maxPriorityFeePerGas: row.lastMaxPriorityFeePerGas,
    }),
    originalFees: toFees({
      maxFeePerGas: row.originalMaxFeePerGas,
      maxPriorityFeePerGas: row.originalMaxPriorityFeePerGas,
    }),
  };
}

/**
 * Columns to write when a transaction goes out at `fees`. The original is written only once,
 * via COALESCE: the cap is a multiple of what the transaction was *originally* willing to pay,
 * so letting escalation overwrite it would let the ceiling climb with the fee it bounds.
 */
function feeUpdate(fees: GasFees | undefined) {
  if (!fees) return {};
  const maxFee = fees.maxFeePerGas.toString();
  const priorityFee = fees.maxPriorityFeePerGas.toString();
  return {
    lastMaxFeePerGas: maxFee,
    lastMaxPriorityFeePerGas: priorityFee,
    originalMaxFeePerGas: sql`COALESCE(${serverWalletTransactions.originalMaxFeePerGas}, ${maxFee})`,
    originalMaxPriorityFeePerGas: sql`COALESCE(${serverWalletTransactions.originalMaxPriorityFeePerGas}, ${priorityFee})`,
  };
}

export function createDrizzleServerTransactionStore(options: {
  chainId: number;
  database: Database;
  newId: () => string;
  walletAddress: string;
}): ServerTransactionStore {
  const walletAddress = options.walletAddress.toLowerCase();
  const { chainId, database } = options;
  const scope = and(
    eq(serverWalletTransactions.walletAddress, walletAddress),
    eq(serverWalletTransactions.chainId, chainId)
  );
  const allocatorScope = and(
    eq(serverWalletNonces.walletAddress, walletAddress),
    eq(serverWalletNonces.chainId, chainId)
  );

  return {
    async allocate(context) {
      return database.transaction(async (tx) => {
        // Prefer a recycled nonce so an earlier failed broadcast cannot leave a hole that
        // stalls every higher nonce behind it. SKIP LOCKED lets concurrent dispatchers take
        // different rows instead of queueing behind each other.
        const recycled = await tx
          .select({ id: serverWalletTransactions.id, nonce: serverWalletTransactions.nonce })
          .from(serverWalletTransactions)
          .where(and(scope, eq(serverWalletTransactions.status, 'recycled')))
          .orderBy(asc(serverWalletTransactions.nonce))
          .limit(1)
          .for('update', { skipLocked: true });

        const reused = recycled[0];
        if (reused) {
          await tx
            .update(serverWalletTransactions)
            .set({
              attempts: sql`${serverWalletTransactions.attempts} + 1`,
              context: context ?? null,
              status: 'reserved',
              updatedAt: new Date(),
            })
            .where(eq(serverWalletTransactions.id, reused.id));
          return { id: reused.id, nonce: reused.nonce };
        }

        const [allocated] = await tx
          .update(serverWalletNonces)
          .set({ nextNonce: sql`${serverWalletNonces.nextNonce} + 1`, updatedAt: new Date() })
          .where(allocatorScope)
          .returning({ nextNonce: serverWalletNonces.nextNonce });

        if (!allocated) throw new Error('Server wallet nonce allocator row is missing');

        const nonce = allocated.nextNonce - 1;
        const id = options.newId();
        await tx.insert(serverWalletTransactions).values({
          chainId,
          context: context ?? null,
          id,
          nonce,
          status: 'reserved',
          walletAddress,
        });
        return { id, nonce };
      });
    },

    async listAbandonedReservations(cutoff, limit) {
      const rows = await database
        .select({
          ...feeColumns,
          id: serverWalletTransactions.id,
          nonce: serverWalletTransactions.nonce,
        })
        .from(serverWalletTransactions)
        .where(
          and(
            scope,
            eq(serverWalletTransactions.status, 'reserved'),
            lt(serverWalletTransactions.updatedAt, cutoff)
          )
        )
        .orderBy(asc(serverWalletTransactions.nonce))
        .limit(limit);
      return rows.map((row) => ({ id: row.id, nonce: row.nonce, ...splitFees(row) }));
    },

    async listBlockingRecycled(cutoff, limit) {
      const inFlight = alias(serverWalletTransactions, 'in_flight');
      const rows = await database
        .select({
          ...feeColumns,
          id: serverWalletTransactions.id,
          nonce: serverWalletTransactions.nonce,
        })
        .from(serverWalletTransactions)
        .where(
          and(
            scope,
            eq(serverWalletTransactions.status, 'recycled'),
            lt(serverWalletTransactions.updatedAt, cutoff),
            exists(
              database
                .select({ one: sql`1` })
                .from(inFlight)
                .where(
                  and(
                    eq(inFlight.walletAddress, walletAddress),
                    eq(inFlight.chainId, chainId),
                    eq(inFlight.status, 'broadcast'),
                    gt(inFlight.nonce, serverWalletTransactions.nonce)
                  )
                )
            )
          )
        )
        .orderBy(asc(serverWalletTransactions.nonce))
        .limit(limit);
      return rows.map((row) => ({ id: row.id, nonce: row.nonce, ...splitFees(row) }));
    },

    async listBroadcast(limit) {
      const rows = await database
        .select({
          ...feeColumns,
          broadcastAt: serverWalletTransactions.broadcastAt,
          id: serverWalletTransactions.id,
          nonce: serverWalletTransactions.nonce,
          replacedTxHash: serverWalletTransactions.replacedTxHash,
          txHash: serverWalletTransactions.txHash,
        })
        .from(serverWalletTransactions)
        .where(and(scope, eq(serverWalletTransactions.status, 'broadcast')))
        .orderBy(asc(serverWalletTransactions.nonce))
        .limit(limit);
      return rows.map((row) => ({
        broadcastAt: row.broadcastAt,
        id: row.id,
        nonce: row.nonce,
        replacedTxHash: row.replacedTxHash,
        txHash: row.txHash,
        ...splitFees(row),
      }));
    },

    async recordReplacement(id, hash, fields = {}) {
      const now = new Date();
      await database
        .update(serverWalletTransactions)
        .set({
          ...feeUpdate(fields.fees),
          // Written in the same statement as the hash it describes. Splitting them would open
          // a window in which the row claims a replacement's hash without saying so.
          ...(fields.replacedTxHash === undefined ? {} : { replacedTxHash: fields.replacedTxHash }),
          attempts: sql`${serverWalletTransactions.attempts} + 1`,
          broadcastAt: now,
          status: 'broadcast',
          txHash: hash,
          updatedAt: now,
        })
        .where(eq(serverWalletTransactions.id, id));
    },

    async resync(readPendingNonce) {
      const pendingNonce = await readPendingNonce();
      await database
        .update(serverWalletNonces)
        .set({ nextNonce: pendingNonce, updatedAt: new Date() })
        .where(and(allocatorScope, sql`${serverWalletNonces.nextNonce} < ${pendingNonce}`));
    },

    async seed(readPendingNonce) {
      const existing = await database
        .select({ nextNonce: serverWalletNonces.nextNonce })
        .from(serverWalletNonces)
        .where(allocatorScope)
        .limit(1);
      if (existing.length > 0) return;

      // Read the chain outside any transaction, then let the primary key settle a race
      // between replicas seeding at the same moment.
      const pendingNonce = await readPendingNonce();
      await database
        .insert(serverWalletNonces)
        .values({ chainId, nextNonce: pendingNonce, walletAddress })
        .onConflictDoNothing();
    },

    async setStatus(id, status, fields = {}) {
      const now = new Date();
      await database
        .update(serverWalletTransactions)
        .set({
          ...feeUpdate(fields.fees),
          ...(fields.hash ? { txHash: fields.hash } : {}),
          ...(status === 'broadcast' ? { broadcastAt: now } : {}),
          ...(status === 'confirmed' ? { confirmedAt: now } : {}),
          ...(fields.error === undefined ? {} : { lastError: errorText(fields.error) }),
          status,
          updatedAt: now,
        })
        .where(eq(serverWalletTransactions.id, id));
    },
  };
}
