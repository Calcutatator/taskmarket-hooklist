import type {
  AllocatedNonce,
  ServerTransactionStatus,
  ServerTransactionStore,
} from '../../src/lib/server-transaction-store';

type Row = {
  broadcastAt: Date | null;
  id: string;
  nonce: number;
  recycledAt: Date;
  reservedAt: Date;
  status: ServerTransactionStatus;
  txHash: string | null;
};

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
        id: `tx-${++idCounter}`,
        nonce,
        recycledAt: new Date(0),
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
        .map<AllocatedNonce>((row) => ({ id: row.id, nonce: row.nonce })),

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
        .map<AllocatedNonce>((row) => ({ id: row.id, nonce: row.nonce }));
    },

    listBroadcast: async (limit) =>
      state.rows
        .filter((row) => row.status === 'broadcast')
        .sort((a, b) => a.nonce - b.nonce)
        .slice(0, limit)
        .map((row) => ({
          broadcastAt: row.broadcastAt,
          id: row.id,
          nonce: row.nonce,
          txHash: row.txHash,
        })),

    recordReplacement: async (id, hash) => {
      const row = state.rows.find((candidate) => candidate.id === id);
      if (!row) return;
      row.broadcastAt = new Date();
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
      if (fields?.hash) row.txHash = fields.hash;
      if (status === 'recycled') row.recycledAt = new Date();
      if (status === 'broadcast' && !row.broadcastAt) row.broadcastAt = new Date();
    },
  };

  return { state, store };
}
