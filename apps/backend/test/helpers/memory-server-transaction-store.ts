import type {
  GasFees,
  ReplaceableRow,
  ServerTransactionStatus,
  ServerTransactionStore,
} from '../../src/lib/server-transaction-store';

type Row = {
  broadcastAt: Date | null;
  clearingTxHash: string | null;
  id: string;
  lastFees: GasFees | null;
  nonce: number;
  originalFees: GasFees | null;
  recycledAt: Date;
  replacedTxHash: string | null;
  reservedAt: Date;
  status: ServerTransactionStatus;
  txHash: string | null;
};

function replaceable(row: Row): ReplaceableRow {
  return {
    clearingTxHash: row.clearingTxHash,
    id: row.id,
    lastFees: row.lastFees,
    nonce: row.nonce,
    originalFees: row.originalFees,
  };
}

/** Mirrors the drizzle store's COALESCE: the original fee is written once and never moves. */
function recordFees(row: Row, fees: GasFees | undefined) {
  if (!fees) return;
  row.lastFees = fees;
  row.originalFees ??= fees;
}

/**
 * In-memory allocator with the same observable behavior as the drizzle store: recycled
 * nonces are handed out before new ones, the counter only ever moves forward, and a resync
 * can raise it but never lower it.
 */
export function createMemoryServerTransactionStore(seed?: number) {
  const state = {
    allocations: 0,
    nextNonce: seed,
    rows: [] as Row[],
    seeded: seed !== undefined,
  };
  let idCounter = 0;

  const store: ServerTransactionStore = {
    allocate: async (context) => {
      void context;
      state.allocations += 1;
      const recycled = state.rows
        .filter((row) => row.status === 'recycled')
        .sort((a, b) => a.nonce - b.nonce)[0];
      if (recycled) {
        recycled.status = 'reserved';
        recycled.reservedAt = new Date();
        return { id: recycled.id, nonce: recycled.nonce };
      }
      const nonce = state.nextNonce ?? 0;
      state.nextNonce = nonce + 1;
      const row: Row = {
        broadcastAt: null,
        clearingTxHash: null,
        id: `tx-${++idCounter}`,
        lastFees: null,
        nonce,
        originalFees: null,
        recycledAt: new Date(0),
        replacedTxHash: null,
        reservedAt: new Date(),
        status: 'reserved',
        txHash: null,
      };
      state.rows.push(row);
      return { id: row.id, nonce: row.nonce };
    },

    listAbandonedReservations: async (cutoff, limit) =>
      state.rows
        .filter((row) => row.status === 'reserved' && row.reservedAt < cutoff)
        .sort((a, b) => a.nonce - b.nonce)
        .slice(0, limit)
        .map(replaceable),

    listBlockingRecycled: async (cutoff, limit) => {
      const highestBroadcast = state.rows
        .filter((row) => row.status === 'broadcast')
        .reduce((max, row) => Math.max(max, row.nonce), -1);
      return state.rows
        .filter(
          (row) =>
            row.status === 'recycled' && row.recycledAt < cutoff && row.nonce < highestBroadcast
        )
        .sort((a, b) => a.nonce - b.nonce)
        .slice(0, limit)
        .map(replaceable);
    },

    listBroadcast: async (limit) =>
      state.rows
        .filter((row) => row.status === 'broadcast')
        .sort((a, b) => a.nonce - b.nonce)
        .slice(0, limit)
        .map((row) => ({
          ...replaceable(row),
          broadcastAt: row.broadcastAt,
          replacedTxHash: row.replacedTxHash,
          txHash: row.txHash,
        })),

    recordReplacement: async (id, hash, fields) => {
      const row = state.rows.find((candidate) => candidate.id === id);
      if (!row) return;
      row.broadcastAt = new Date();
      recordFees(row, fields?.fees);
      if (fields?.clearing) row.clearingTxHash = hash;
      if (fields?.replacedTxHash !== undefined) row.replacedTxHash = fields.replacedTxHash;
      row.status = 'broadcast';
      row.txHash = hash;
    },

    resync: async (readPendingNonce) => {
      const pending = await readPendingNonce();
      if ((state.nextNonce ?? 0) < pending) state.nextNonce = pending;
    },

    seed: async (readPendingNonce) => {
      if (state.seeded) return;
      state.seeded = true;
      state.nextNonce = await readPendingNonce();
    },

    setStatus: async (id, status, fields) => {
      const row = state.rows.find((candidate) => candidate.id === id);
      if (!row) return;
      row.status = status;
      recordFees(row, fields?.fees);
      if (fields?.hash) row.txHash = fields.hash;
      if (status === 'recycled') row.recycledAt = new Date();
      if (status === 'broadcast' && !row.broadcastAt) row.broadcastAt = new Date();
    },
  };

  return { state, store };
}
