// Verifies: ADR-0039
import {
  custom,
  decodeFunctionData,
  encodeFunctionResult,
  multicall3Abi,
  parseAbi,
} from 'viem';
import { describe, expect, it, vi } from 'vitest';
import {
  createCountingRpcTransport,
  createRpcGateway,
  getRpcOperation,
  instrumentRpcTransport,
  runWithRpcApplicationAttempt,
  runWithRpcOperation,
  type RpcTelemetryEvent,
} from '../../../src/lib/rpc-gateway';
import { publicProcedure, router } from '../../../src/trpc';

const PRIVATE_KEY = `0x${'11'.repeat(32)}` as const;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('RPC gateway', () => {
  it('reuses one public client and one nonce-managed wallet client', () => {
    const provider = { request: vi.fn().mockResolvedValue('0x1') };
    const gateway = createRpcGateway({
      chainId: 84532,
      providerUrl: 'https://rpc.example.test/private-token',
      serverPrivateKey: PRIVATE_KEY,
      transport: custom(provider, { retryCount: 0 }),
    });

    expect(gateway.getPublicClient()).toBe(gateway.getPublicClient());
    expect(gateway.getServerWallet().client).toBe(gateway.getServerWallet().client);
    expect(gateway.getServerWallet().account).toBe(gateway.getServerWallet().account);
    expect(gateway.getServerWallet().account.nonceManager).toBeDefined();
  });

  it('records every physical retry attempt without changing retry behavior', async () => {
    const provider = {
      request: vi
        .fn()
        .mockRejectedValueOnce(new Error('temporary provider failure'))
        .mockResolvedValueOnce('0x14'),
    };
    const counter = createCountingRpcTransport(
      custom(provider, { retryCount: 1, retryDelay: 0 }),
      84532
    );
    const gateway = createRpcGateway({
      chainId: 84532,
      providerUrl: 'https://rpc.example.test/private-token',
      serverPrivateKey: PRIVATE_KEY,
      transport: counter.transport,
    });

    const result = await runWithRpcOperation(
      { kind: 'procedure', name: 'wallet.balance' },
      () => gateway.getPublicClient().getBlockNumber()
    );

    expect(result).toBe(20n);
    expect(provider.request).toHaveBeenCalledTimes(2);
    expect(counter.snapshot()).toMatchObject({ providerRequests: 2 });
    expect(
      counter.events.map(({ applicationAttempt, outcome, transportAttempt }) => ({
        applicationAttempt,
        outcome,
        transportAttempt,
      }))
    ).toEqual([
      { applicationAttempt: 1, outcome: 'failure', transportAttempt: 1 },
      { applicationAttempt: 1, outcome: 'success', transportAttempt: 2 },
    ]);
  });

  it('records application retries separately from transport retries', async () => {
    const provider = {
      request: vi
        .fn()
        .mockRejectedValueOnce(new Error('application attempt one, transport attempt one'))
        .mockRejectedValueOnce(new Error('application attempt one, transport attempt two'))
        .mockResolvedValueOnce('0x14'),
    };
    const counter = createCountingRpcTransport(
      custom(provider, { retryCount: 1, retryDelay: 0 }),
      84532
    );
    const gateway = createRpcGateway({
      chainId: 84532,
      providerUrl: 'https://rpc.example.test/private-token',
      serverPrivateKey: PRIVATE_KEY,
      transport: counter.transport,
    });

    let result: bigint | undefined;
    for (let applicationAttempt = 1; applicationAttempt <= 2; applicationAttempt++) {
      try {
        result = await runWithRpcApplicationAttempt(applicationAttempt, () =>
          gateway.getPublicClient().getBlockNumber()
        );
        break;
      } catch {
        // The application owns this retry; the transport independently owns its retries.
      }
    }

    expect(result).toBe(20n);
    expect(provider.request).toHaveBeenCalledTimes(3);
    expect(
      counter.events.map(({ applicationAttempt, transportAttempt }) => ({
        applicationAttempt,
        transportAttempt,
      }))
    ).toEqual([
      { applicationAttempt: 1, transportAttempt: 1 },
      { applicationAttempt: 1, transportAttempt: 2 },
      { applicationAttempt: 2, transportAttempt: 1 },
    ]);
  });

  it('isolates logical operation attribution across concurrent requests', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const provider = {
      request: vi
        .fn()
        .mockImplementationOnce(() => first.promise)
        .mockImplementationOnce(() => second.promise),
    };
    const counter = createCountingRpcTransport(custom(provider, { retryCount: 0 }), 84532);
    const gateway = createRpcGateway({
      chainId: 84532,
      providerUrl: 'https://rpc.example.test/private-token',
      serverPrivateKey: PRIVATE_KEY,
      transport: counter.transport,
    });

    const tasksRequest = runWithRpcOperation(
      { kind: 'procedure', name: 'tasks.get' },
      () => gateway.getPublicClient().request({ method: 'eth_blockNumber' })
    );
    const indexerRequest = runWithRpcOperation({ kind: 'background', name: 'indexer' }, () =>
      gateway.getPublicClient().request({ method: 'eth_chainId' })
    );

    second.resolve('0x14');
    await indexerRequest;
    first.resolve('0x15');
    await tasksRequest;

    expect(counter.events.map((event) => event.operation).sort()).toEqual([
      'background:indexer',
      'procedure:tasks.get',
    ]);
    expect(counter.events).toEqual([
      expect.objectContaining({
        inFlightAtEnd: 1,
        inFlightAtStart: 2,
        operation: 'background:indexer',
      }),
      expect.objectContaining({
        inFlightAtEnd: 0,
        inFlightAtStart: 1,
        operation: 'procedure:tasks.get',
      }),
    ]);
    expect(getRpcOperation()).toEqual({ kind: 'runtime', name: 'unattributed' });
  });

  it('attributes calls made by a tRPC procedure to its bounded path', async () => {
    const testRouter = router({
      observed: publicProcedure.query(() => getRpcOperation()),
    });

    const result = await testRouter.createCaller({} as never).observed();

    expect(result).toEqual({ kind: 'procedure', name: 'observed' });
  });

  it('derives real multicall subcalls at the transport seam, including viem splits', async () => {
    const valueAbi = parseAbi(['function value() view returns (uint256)']);
    const provider = {
      request: vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
        expect(method).toBe('eth_call');
        const transaction = params?.[0] as { data: `0x${string}` };
        const decoded = decodeFunctionData({ abi: multicall3Abi, data: transaction.data });
        expect(decoded.functionName).toBe('aggregate3');
        const calls = decoded.args?.[0];
        if (!Array.isArray(calls)) throw new Error('Expected aggregate3 calls');
        return encodeFunctionResult({
          abi: multicall3Abi,
          functionName: 'aggregate3',
          result: calls.map(() => ({
            returnData: encodeFunctionResult({
              abi: valueAbi,
              functionName: 'value',
              result: 7n,
            }),
            success: true,
          })),
        });
      }),
    };
    const counter = createCountingRpcTransport(custom(provider, { retryCount: 0 }), 84532);
    const gateway = createRpcGateway({
      chainId: 84532,
      providerUrl: 'https://rpc.example.test/private-token',
      serverPrivateKey: PRIVATE_KEY,
      transport: counter.transport,
    });
    const contracts = Array.from({ length: 3 }, (_, index) => ({
      abi: valueAbi,
      address: `0x${String(index + 1).padStart(40, '0')}` as `0x${string}`,
      functionName: 'value' as const,
    }));

    await runWithRpcOperation({ kind: 'procedure', name: 'tasks.get' }, () =>
      gateway.getPublicClient().multicall({ batchSize: 0, contracts })
    );

    expect(counter.snapshot()).toEqual({ providerRequests: 1, logicalSubcalls: 3 });
    expect(counter.events[0]).toMatchObject({ method: 'eth_call', subcalls: 3 });

    counter.reset();
    provider.request.mockClear();
    await gateway.getPublicClient().multicall({ batchSize: 1, contracts });

    expect(counter.snapshot()).toEqual({ providerRequests: 3, logicalSubcalls: 3 });
    expect(counter.events.map((event) => event.subcalls)).toEqual([1, 1, 1]);
    expect(provider.request).toHaveBeenCalledTimes(3);
  });

  it('bounds labels and never records provider URLs, params, identifiers, or raw errors', async () => {
    const events: RpcTelemetryEvent[] = [];
    const sensitiveValues = [
      'private-token',
      '0x1111111111111111111111111111111111111111',
      `0x${'22'.repeat(32)}`,
      'sensitive revert detail',
    ];
    const provider = {
      request: vi.fn().mockRejectedValue(new Error('sensitive revert detail')),
    };
    const transport = instrumentRpcTransport(
      custom(provider, { retryCount: 0 }),
      (event) => {
        events.push(event);
      },
      84532
    );
    const gateway = createRpcGateway({
      chainId: 84532,
      providerUrl: 'https://rpc.example.test/private-token',
      serverPrivateKey: PRIVATE_KEY,
      transport,
    });

    await expect(
      runWithRpcOperation(
        { kind: 'procedure', name: `tasks.get:${'a'.repeat(100)}` },
        () =>
          gateway.getPublicClient().request({
            method: 'eth_call',
            params: [
              {
                data: `0x${'22'.repeat(32)}`,
                to: '0x1111111111111111111111111111111111111111',
              },
            ],
          })
      )
    ).rejects.toThrow();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      cacheOutcome: 'not_applicable',
      chainId: 84532,
      failureClass: 'transport',
      operation: 'procedure:unknown',
      outcome: 'failure',
      singleflightOutcome: 'not_applicable',
    });
    const serialized = JSON.stringify(events);
    for (const value of sensitiveValues) expect(serialized).not.toContain(value);
  });

  it('keeps telemetry failures from affecting successful provider requests', async () => {
    const transport = instrumentRpcTransport(
      custom({ request: vi.fn().mockResolvedValue('0x14') }, { retryCount: 0 }),
      () => {
        throw new Error('telemetry unavailable');
      },
      84532
    );
    const gateway = createRpcGateway({
      chainId: 84532,
      providerUrl: 'https://rpc.example.test/private-token',
      serverPrivateKey: PRIVATE_KEY,
      transport,
    });

    await expect(gateway.getPublicClient().getBlockNumber()).resolves.toBe(20n);
  });

  it('bounds unsupported chain IDs and reports Tier 0 cache and singleflight outcomes', async () => {
    const counter = createCountingRpcTransport(
      custom({ request: vi.fn().mockResolvedValue('0x14') }, { retryCount: 0 }),
      31337
    );
    const gateway = createRpcGateway({
      chainId: 31337,
      providerUrl: 'http://127.0.0.1:8545',
      serverPrivateKey: PRIVATE_KEY,
      transport: counter.transport,
    });

    await gateway.getPublicClient().getBlockNumber();

    expect(counter.events).toEqual([
      expect.objectContaining({
        cacheOutcome: 'not_applicable',
        chainId: 'other',
        singleflightOutcome: 'not_applicable',
      }),
    ]);
  });
});
