// Implements: ADR-0039
import type { RpcTelemetryEvent } from './rpc-gateway';

export type RpcTelemetryBucket = {
  applicationRetries: number;
  chainId: RpcTelemetryEvent['chainId'];
  durationMsMax: number;
  durationMsTotal: number;
  failureClass: RpcTelemetryEvent['failureClass'];
  method: string;
  operation: string;
  outcome: RpcTelemetryEvent['outcome'];
  requests: number;
  subcalls: number;
  transportRetries: number;
};

export type RpcTelemetrySnapshot = {
  buckets: RpcTelemetryBucket[];
  inFlightMax: number;
  logicalSubcalls: number;
  providerRequests: number;
  windowMs: number;
};

export const DEFAULT_FLUSH_INTERVAL_MS = 60_000;

/**
 * Fold provider-request events into bounded buckets and emit one periodic summary.
 *
 * ADR-0039 requires that every physical provider attempt is accounted for. It does not require
 * that every attempt produces its own log line, and the original sink did exactly that at
 * `logger.http` -- a level that is enabled in production. The indexer alone polls continuously,
 * so that is tens of thousands of structured lines per replica per day at zero user traffic,
 * bought for data nobody can aggregate without shipping and re-parsing it.
 *
 * Aggregating in-process keeps the measurement and drops the volume. The bucket key uses only
 * the fields ADR-0039 already constrains to bounded cardinality -- operation, method, outcome,
 * failure class, chain -- so the summary cannot grow with traffic, task count, or wallet count.
 */
export function createRpcTelemetryAggregator() {
  const buckets = new Map<string, RpcTelemetryBucket>();
  let providerRequests = 0;
  let logicalSubcalls = 0;
  let inFlightMax = 0;
  let windowStartedAt = performance.now();

  function record(event: RpcTelemetryEvent): void {
    const key = [
      event.operation,
      event.method,
      event.outcome,
      event.failureClass,
      String(event.chainId),
    ].join('|');

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        applicationRetries: 0,
        chainId: event.chainId,
        durationMsMax: 0,
        durationMsTotal: 0,
        failureClass: event.failureClass,
        method: event.method,
        operation: event.operation,
        outcome: event.outcome,
        requests: 0,
        subcalls: 0,
        transportRetries: 0,
      };
      buckets.set(key, bucket);
    }

    bucket.requests += 1;
    bucket.subcalls += event.subcalls;
    bucket.durationMsTotal += event.durationMs;
    bucket.durationMsMax = Math.max(bucket.durationMsMax, event.durationMs);
    // Attempt numbers are 1-based, so anything above 1 is a retry of an earlier attempt.
    if (event.applicationAttempt > 1) bucket.applicationRetries += 1;
    if (event.transportAttempt > 1) bucket.transportRetries += 1;

    providerRequests += 1;
    logicalSubcalls += event.subcalls;
    inFlightMax = Math.max(inFlightMax, event.inFlightAtStart);
  }

  /** Returns null when nothing happened in the window, so an idle process stays silent. */
  function drain(now = performance.now()): RpcTelemetrySnapshot | null {
    if (providerRequests === 0) {
      windowStartedAt = now;
      return null;
    }

    const snapshot: RpcTelemetrySnapshot = {
      buckets: [...buckets.values()].sort((a, b) => b.requests - a.requests),
      inFlightMax,
      logicalSubcalls,
      providerRequests,
      windowMs: Math.max(0, Math.round(now - windowStartedAt)),
    };

    buckets.clear();
    providerRequests = 0;
    logicalSubcalls = 0;
    inFlightMax = 0;
    windowStartedAt = now;
    return snapshot;
  }

  return { drain, record };
}

type SummaryLogger = { info: (message: string, metadata: Record<string, unknown>) => unknown };

/**
 * Wire an aggregator to a periodic summary log. Returns the sink to hand to the gateway.
 */
export function startRpcTelemetrySummary(
  logger: SummaryLogger,
  intervalMs: number = DEFAULT_FLUSH_INTERVAL_MS
) {
  const aggregator = createRpcTelemetryAggregator();

  const timer = setInterval(() => {
    const snapshot = aggregator.drain();
    if (snapshot) logger.info('rpc.provider_summary', { rpc: snapshot });
  }, intervalMs);
  timer.unref?.();

  return { sink: (event: RpcTelemetryEvent) => aggregator.record(event), timer };
}
