// Covers the sweep side of the stale-intent count that ADR-0053 describes. No machine-readable
// back-pointer to it, for the reason given at the top of test/unit/routers/health.test.ts.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubServerEnvironment } from '../../helpers/server-environment';

const restoreServerEnvironment = stubServerEnvironment();

vi.mock('../../../src/db/client', () => ({ db: {} }));

vi.mock('../../../src/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../src/services/relayed-intent-registry', () => ({
  dispatchRelayedIntent: vi.fn().mockResolvedValue('broadcast'),
}));
vi.mock('../../../src/services/relayed-intent-settlement', () => ({
  settleAbandonedIntents: vi.fn().mockResolvedValue(undefined),
  // Runs on the same pass (ADR-0073); stubbed for the same reason as the sweep above.
  settleFailedTransactionIntents: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../src/services/relayed-intent-stranded', () => ({
  settleStrandedIntents: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../src/services/reservation-sweep', () => ({
  expireStaleReservations: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../src/services/orphaned-payments', () => ({
  settlePendingOrphanedRefunds: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/services/relayed-intents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/services/relayed-intents')>()),
  countStaleNonTerminalIntents: vi.fn().mockResolvedValue(0),
  listUnbroadcastIntents: vi.fn().mockResolvedValue([]),
}));

const { countStaleNonTerminalIntents } = await import('../../../src/services/relayed-intents');
const { expireStaleReservations } = await import('../../../src/services/reservation-sweep');
const { createRelayedIntentWorker } = await import('../../../src/services/relayed-intent-worker');
const { clearStaleIntentSnapshot, readStaleIntentSnapshot } = await import(
  '../../../src/services/intent-health-snapshot'
);

afterAll(restoreServerEnvironment);

const NOW = new Date('2026-08-06T12:00:00.000Z');

function worker() {
  return createRelayedIntentWorker({ now: () => NOW.getTime() });
}

describe('publishing the stale-intent count from the sweep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(countStaleNonTerminalIntents).mockResolvedValue(0);
    clearStaleIntentSnapshot();
  });

  it('publishes the count once per pass, with the time it was taken', async () => {
    vi.mocked(countStaleNonTerminalIntents).mockResolvedValue(4);

    await worker()();

    // Once per pass is the property that matters. This is what moves the cost of the count off
    // the public health endpoint's request path and onto the worker's interval, where it is
    // bounded no matter how hard health is polled.
    expect(countStaleNonTerminalIntents).toHaveBeenCalledOnce();
    expect(readStaleIntentSnapshot()).toEqual({
      measuredAt: NOW.toISOString(),
      staleNonTerminal: 4,
    });
  });

  it('counts what the sweeps could not resolve, not what they started with', async () => {
    const order: string[] = [];
    vi.mocked(expireStaleReservations).mockImplementation(async () => {
      order.push('sweep');
    });
    vi.mocked(countStaleNonTerminalIntents).mockImplementation(async () => {
      order.push('count');
      return 1;
    });

    await worker()();

    // Counted at the end of the pass deliberately. A number taken before the sweeps ran would
    // include every row they were about to resolve, which reports normal in-flight work as
    // stuck -- and a counter that fires on healthy traffic is one people learn to ignore.
    expect(order).toEqual(['sweep', 'count']);
  });

  it('keeps the previous answer when a pass cannot compute a new one', async () => {
    vi.mocked(countStaleNonTerminalIntents).mockResolvedValueOnce(7);
    await worker()();

    vi.mocked(countStaleNonTerminalIntents).mockRejectedValueOnce(new Error('database down'));
    await expect(worker()()).resolves.toBeUndefined();

    // The failure must not take down a pass whose real work already succeeded, and the last
    // known answer is more useful than none: it is served with its original `measuredAt`, so a
    // reader sees it ageing rather than seeing the field disappear and come back.
    expect(readStaleIntentSnapshot()).toEqual({
      measuredAt: NOW.toISOString(),
      staleNonTerminal: 7,
    });
  });
});
