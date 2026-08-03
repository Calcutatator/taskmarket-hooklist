// Verifies: ADR-0039
import { describe, expect, it } from 'vitest';
import { createRpcTelemetryAggregator } from '../../../src/lib/rpc-telemetry-aggregator';
import type { RpcTelemetryEvent } from '../../../src/lib/rpc-gateway';

function event(overrides: Partial<RpcTelemetryEvent> = {}): RpcTelemetryEvent {
  return {
    applicationAttempt: 1,
    cacheOutcome: 'not_applicable',
    chainId: 84532,
    durationMs: 10,
    failureClass: 'none',
    inFlightAtEnd: 0,
    inFlightAtStart: 1,
    method: 'eth_call',
    operation: 'procedure:tasks.get',
    outcome: 'success',
    singleflightOutcome: 'not_applicable',
    subcalls: 1,
    transportAttempt: 1,
    ...overrides,
  };
}

describe('rpc telemetry aggregator', () => {
  it('stays silent when nothing happened, so an idle process logs nothing', () => {
    const aggregator = createRpcTelemetryAggregator();
    expect(aggregator.drain()).toBeNull();
  });

  it('folds identical events into one bucket while counting every request', () => {
    const aggregator = createRpcTelemetryAggregator();
    aggregator.record(event());
    aggregator.record(event());
    aggregator.record(event());

    const snapshot = aggregator.drain()!;
    expect(snapshot.providerRequests).toBe(3);
    expect(snapshot.buckets).toHaveLength(1);
    expect(snapshot.buckets[0]).toMatchObject({ method: 'eth_call', requests: 3 });
  });

  it('separates buckets by operation, method, outcome, failure class and chain', () => {
    const aggregator = createRpcTelemetryAggregator();
    aggregator.record(event());
    aggregator.record(event({ operation: 'background:indexer' }));
    aggregator.record(event({ method: 'eth_getLogs' }));
    aggregator.record(event({ outcome: 'failure', failureClass: 'timeout' }));
    aggregator.record(event({ chainId: 8453 }));

    expect(aggregator.drain()!.buckets).toHaveLength(5);
  });

  it('accumulates subcalls, retries, and latency', () => {
    const aggregator = createRpcTelemetryAggregator();
    aggregator.record(event({ durationMs: 10, subcalls: 4 }));
    aggregator.record(event({ applicationAttempt: 2, durationMs: 40, subcalls: 2 }));
    aggregator.record(event({ durationMs: 25, subcalls: 1, transportAttempt: 3 }));

    const snapshot = aggregator.drain()!;
    const bucket = snapshot.buckets[0];
    expect(bucket.subcalls).toBe(7);
    expect(bucket.durationMsTotal).toBe(75);
    expect(bucket.durationMsMax).toBe(40);
    expect(bucket.applicationRetries).toBe(1);
    expect(bucket.transportRetries).toBe(1);
    // Multicall means one provider request can carry several logical subcalls.
    expect(snapshot.providerRequests).toBe(3);
    expect(snapshot.logicalSubcalls).toBe(7);
  });

  it('reports peak concurrency across the window', () => {
    const aggregator = createRpcTelemetryAggregator();
    aggregator.record(event({ inFlightAtStart: 2 }));
    aggregator.record(event({ inFlightAtStart: 7 }));
    aggregator.record(event({ inFlightAtStart: 3 }));

    expect(aggregator.drain()!.inFlightMax).toBe(7);
  });

  it('orders buckets by request volume, so the loudest caller reads first', () => {
    const aggregator = createRpcTelemetryAggregator();
    aggregator.record(event({ operation: 'procedure:tasks.get' }));
    for (let i = 0; i < 5; i++) aggregator.record(event({ operation: 'background:indexer' }));

    expect(aggregator.drain()!.buckets[0].operation).toBe('background:indexer');
  });

  it('resets after draining, so windows do not double-count', () => {
    const aggregator = createRpcTelemetryAggregator();
    aggregator.record(event());
    expect(aggregator.drain()!.providerRequests).toBe(1);
    expect(aggregator.drain()).toBeNull();

    aggregator.record(event());
    expect(aggregator.drain()!.providerRequests).toBe(1);
  });

  it('keeps bucket count bounded by label combinations, not by traffic volume', () => {
    const aggregator = createRpcTelemetryAggregator();
    for (let i = 0; i < 1000; i++) {
      aggregator.record(event({ durationMs: i, subcalls: (i % 3) + 1 }));
    }

    const snapshot = aggregator.drain()!;
    expect(snapshot.providerRequests).toBe(1000);
    expect(snapshot.buckets).toHaveLength(1);
  });
});
