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

export type PendingTransactionRow = {
  broadcastAt: Date | null;
  id: string;
  nonce: number;
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
  listAbandonedReservations(cutoff: Date, limit: number): Promise<AllocatedNonce[]>;
  /**
   * Recycled rows older than the cutoff whose nonce sits below an in-flight transaction.
   *
   * A recycled nonce is normally harmless: the next allocation reuses it. It becomes a problem
   * when a higher nonce was already broadcast, because that transaction cannot mine until this
   * one is used, and on a quiet relayer no next allocation is coming.
   */
  listBlockingRecycled(cutoff: Date, limit: number): Promise<AllocatedNonce[]>;
  /** Seed the allocator from the supplied chain nonce if it has never been seeded. */
  seed(readPendingNonce: () => Promise<number>): Promise<void>;
  /** Record a replacement broadcast against an already-allocated nonce. */
  recordReplacement(id: string, hash: string): Promise<void>;
  /** Move the allocator forward when the chain has advanced past it. */
  resync(readPendingNonce: () => Promise<number>): Promise<void>;
  setStatus(
    id: string,
    status: ServerTransactionStatus,
    fields?: { hash?: string; error?: unknown }
  ): Promise<void>;
};

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
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
      return database
        .select({ id: serverWalletTransactions.id, nonce: serverWalletTransactions.nonce })
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
    },

    async listBlockingRecycled(cutoff, limit) {
      const inFlight = alias(serverWalletTransactions, 'in_flight');
      return database
        .select({ id: serverWalletTransactions.id, nonce: serverWalletTransactions.nonce })
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
    },

    async listBroadcast(limit) {
      return database
        .select({
          broadcastAt: serverWalletTransactions.broadcastAt,
          id: serverWalletTransactions.id,
          nonce: serverWalletTransactions.nonce,
          txHash: serverWalletTransactions.txHash,
        })
        .from(serverWalletTransactions)
        .where(and(scope, eq(serverWalletTransactions.status, 'broadcast')))
        .orderBy(asc(serverWalletTransactions.nonce))
        .limit(limit);
    },

    async recordReplacement(id, hash) {
      const now = new Date();
      await database
        .update(serverWalletTransactions)
        .set({
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
