// Implements: ADR-0039
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  BaseError,
  createPublicClient,
  createTransport,
  createWalletClient,
  decodeFunctionData,
  HttpRequestError,
  http,
  multicall3Abi,
  RpcRequestError,
  TimeoutError,
  type Transport,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';
import { nonceManager } from 'viem/nonce';
import { getServerConfig } from '../config/env';

const PROCEDURE_NAME_PATTERN = /^[a-z][a-zA-Z0-9-]{0,31}(?:\.[a-z][a-zA-Z0-9-]{0,31}){0,2}$/;

export type RpcBackgroundOperation = 'indexer' | 'reconciliation';

export type RpcOperation =
  | { kind: 'procedure'; name: string }
  | { kind: 'background'; name: RpcBackgroundOperation }
  | { kind: 'runtime'; name: 'unattributed' };

export type RpcFailureClass = 'none' | 'http' | 'rpc' | 'timeout' | 'transport';

export type RpcTelemetryChainId = 8453 | 84532 | 'other';

export type RpcTelemetryEvent = {
  applicationAttempt: number;
  cacheOutcome: 'not_applicable';
  chainId: RpcTelemetryChainId;
  durationMs: number;
  failureClass: RpcFailureClass;
  inFlightAtEnd: number;
  inFlightAtStart: number;
  method: string;
  operation: string;
  outcome: 'success' | 'failure';
  singleflightOutcome: 'not_applicable';
  subcalls: number;
  transportAttempt: number;
};

export type RpcTelemetrySink = (event: RpcTelemetryEvent) => void;

let runtimeTelemetrySink: RpcTelemetrySink = () => undefined;

export function setRuntimeRpcTelemetrySink(sink: RpcTelemetrySink): void {
  runtimeTelemetrySink = sink;
}

const DEFAULT_OPERATION: RpcOperation = {
  kind: 'runtime',
  name: 'unattributed',
};
type RpcContext = { applicationAttempt: number; operation: RpcOperation };
const DEFAULT_CONTEXT: RpcContext = { applicationAttempt: 1, operation: DEFAULT_OPERATION };
const operationStorage = new AsyncLocalStorage<RpcContext>();

function normalizedOperation(operation: RpcOperation): RpcOperation {
  if (operation.kind === 'procedure') {
    return {
      kind: 'procedure',
      name: PROCEDURE_NAME_PATTERN.test(operation.name) ? operation.name : 'unknown',
    };
  }
  return operation;
}

export function getRpcOperation(): RpcOperation {
  return (operationStorage.getStore() ?? DEFAULT_CONTEXT).operation;
}

export function runWithRpcOperation<T>(operation: RpcOperation, fn: () => T): T {
  const context = operationStorage.getStore() ?? DEFAULT_CONTEXT;
  return operationStorage.run({ ...context, operation: normalizedOperation(operation) }, fn);
}

export function runWithRpcApplicationAttempt<T>(applicationAttempt: number, fn: () => T): T {
  const context = operationStorage.getStore() ?? DEFAULT_CONTEXT;
  const normalizedAttempt =
    Number.isSafeInteger(applicationAttempt) && applicationAttempt > 0 ? applicationAttempt : 1;
  return operationStorage.run({ ...context, applicationAttempt: normalizedAttempt }, fn);
}

function operationLabel(operation: RpcOperation): string {
  return `${operation.kind}:${operation.name}`;
}

function telemetryChainId(chainId: number): RpcTelemetryChainId {
  if (chainId === 8453 || chainId === 84532) return chainId;
  return 'other';
}

function failureClass(error: unknown): RpcFailureClass {
  if (error instanceof TimeoutError) return 'timeout';
  if (error instanceof HttpRequestError) return 'http';
  if (error instanceof RpcRequestError) return 'rpc';
  if (error instanceof BaseError && typeof error.name === 'string' && error.name.includes('Rpc')) {
    return 'rpc';
  }
  return 'transport';
}

function emitSafely(sink: RpcTelemetrySink, event: RpcTelemetryEvent): void {
  try {
    sink(event);
  } catch {
    // Observability must never alter provider behavior.
  }
}

function logicalSubcallCount(args: { method: string; params?: unknown }): number {
  if (args.method !== 'eth_call' || !Array.isArray(args.params)) return 1;
  const transaction = args.params[0];
  if (!transaction || typeof transaction !== 'object' || !('data' in transaction)) return 1;
  const data = transaction.data;
  if (typeof data !== 'string' || !data.startsWith('0x')) return 1;

  try {
    const decoded = decodeFunctionData({ abi: multicall3Abi, data: data as `0x${string}` });
    if (decoded.functionName !== 'aggregate3') return 1;
    const calls = decoded.args?.[0];
    return Array.isArray(calls) ? calls.length : 1;
  } catch {
    return 1;
  }
}

/**
 * Decorate a viem transport at its raw request seam. viem's existing retry wrapper
 * stays outside this function, so each invocation observed here is one real provider
 * attempt and retry behavior remains unchanged.
 */
export function instrumentRpcTransport(
  transport: Transport,
  sink: RpcTelemetrySink,
  chainId: number
): Transport {
  let inFlight = 0;
  const attempts = new WeakMap<object, number>();
  const observedChainId = telemetryChainId(chainId);

  return ((parameters) => {
    const baseTransport = transport(parameters);
    const rawRequest = baseTransport.config.request;
    const observedRequest = async (args: { method: string; params?: unknown }) => {
      const requestKey = args as object;
      const transportAttempt = (attempts.get(requestKey) ?? 0) + 1;
      attempts.set(requestKey, transportAttempt);
      const context = operationStorage.getStore() ?? DEFAULT_CONTEXT;
      const startedAt = performance.now();
      inFlight += 1;
      const inFlightAtStart = inFlight;
      let didFail = false;
      let caughtError: unknown;

      try {
        return await rawRequest(args);
      } catch (error) {
        didFail = true;
        caughtError = error;
        throw error;
      } finally {
        inFlight -= 1;
        emitSafely(sink, {
          applicationAttempt: context.applicationAttempt,
          cacheOutcome: 'not_applicable',
          chainId: observedChainId,
          durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
          failureClass: didFail ? failureClass(caughtError) : 'none',
          inFlightAtEnd: inFlight,
          inFlightAtStart,
          method: args.method,
          operation: operationLabel(context.operation),
          outcome: didFail ? 'failure' : 'success',
          singleflightOutcome: 'not_applicable',
          subcalls: logicalSubcallCount(args),
          transportAttempt,
        });
      }
    };

    return createTransport(
      {
        ...baseTransport.config,
        request: observedRequest as typeof rawRequest,
      },
      baseTransport.value
    );
  }) as Transport;
}

export function createCountingRpcTransport(transport: Transport, chainId: number) {
  const events: RpcTelemetryEvent[] = [];
  return {
    events,
    reset: () => events.splice(0, events.length),
    snapshot: () => ({
      logicalSubcalls: events.reduce((total, event) => total + event.subcalls, 0),
      providerRequests: events.length,
    }),
    transport: instrumentRpcTransport(transport, (event) => events.push(event), chainId),
  };
}

export type RpcGatewayOptions = {
  chainId: number;
  providerUrl: string;
  serverPrivateKey: `0x${string}`;
  transport?: Transport;
};

export function createRpcGateway(options: RpcGatewayOptions) {
  const chain = options.chainId === 84532 ? baseSepolia : base;
  const transport =
    options.transport ??
    instrumentRpcTransport(
      http(options.providerUrl),
      (event) => runtimeTelemetrySink(event),
      options.chainId
    );
  const account = privateKeyToAccount(options.serverPrivateKey, { nonceManager });
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account, chain, transport });
  const serverWallet = { account, address: account.address, client: walletClient };

  return {
    getPublicClient: () => publicClient,
    getServerWallet: () => serverWallet,
  };
}

let runtimeGateway: ReturnType<typeof createRpcGateway> | undefined;

function getRuntimeGateway(): ReturnType<typeof createRpcGateway> {
  if (!runtimeGateway) {
    const config = getServerConfig();
    runtimeGateway = createRpcGateway({
      chainId: config.CHAIN_ID,
      providerUrl: config.BASE_RPC_URL,
      serverPrivateKey: config.SERVER_PRIVATE_KEY as `0x${string}`,
    });
  }
  return runtimeGateway;
}

export function getPublicClient() {
  return getRuntimeGateway().getPublicClient();
}

export function getServerWallet() {
  return getRuntimeGateway().getServerWallet();
}
