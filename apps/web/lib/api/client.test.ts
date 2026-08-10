import {
  IDEMPOTENCY_KEY_HEADER,
  READ_AUTH_ADDRESS_HEADER,
  READ_AUTH_SIGNATURE_HEADER,
} from '@taskmarket/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearCachedReadAuthHeaders, setCachedReadAuthHeaders } from '@/lib/read-auth';
import { makeTrpcClient, READ_AUTH_CONTEXT_KEY } from './client';
import { IDEMPOTENCY_CONTEXT_KEY } from './idempotency';

const ADDRESS = '0x1111111111111111111111111111111111111111';
const SIGNATURE = '0xsignature';

function trpcResponse(data: unknown, batched: boolean) {
  const result = { result: { data } };
  return new Response(JSON.stringify(batched ? [result] : result), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });
}

function headersFor(call: unknown[]): Headers {
  const [input, init] = call as [RequestInfo | URL, RequestInit | undefined];
  return input instanceof Request ? input.headers : new Headers(init?.headers);
}

describe('browser tRPC client submission auth isolation', () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    return trpcResponse([], String(input).includes('batch=1'));
  });

  beforeEach(() => {
    window.localStorage.clear();
    clearCachedReadAuthHeaders();
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    clearCachedReadAuthHeaders();
    vi.unstubAllGlobals();
  });

  it('keeps ordinary submission reads anonymous and scopes authenticated reads to a separate link', async () => {
    setCachedReadAuthHeaders(ADDRESS, {
      [READ_AUTH_ADDRESS_HEADER]: ADDRESS,
      [READ_AUTH_SIGNATURE_HEADER]: SIGNATURE,
    });
    const client = makeTrpcClient();
    const input = { includePreviewUrls: 'media' as const, taskId: 'task-1' };

    await client.submissions.listByTask.query(input);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const anonymousUrl = String(fetchMock.mock.calls[0]?.[0]);
    const anonymousHeaders = headersFor(fetchMock.mock.calls[0] ?? []);
    expect(anonymousUrl).toContain('batch=1');
    expect(anonymousHeaders.has(READ_AUTH_ADDRESS_HEADER)).toBe(false);
    expect(anonymousHeaders.has(READ_AUTH_SIGNATURE_HEADER)).toBe(false);

    await client.submissions.listByTask.query(input, {
      context: { [READ_AUTH_CONTEXT_KEY]: true },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const authenticatedUrl = String(fetchMock.mock.calls[1]?.[0]);
    const authenticatedHeaders = headersFor(fetchMock.mock.calls[1] ?? []);
    expect(authenticatedUrl).not.toContain('batch=1');
    expect(authenticatedHeaders.get(READ_AUTH_ADDRESS_HEADER)).toBe(ADDRESS);
    expect(authenticatedHeaders.get(READ_AUTH_SIGNATURE_HEADER)).toBe(SIGNATURE);
  });
});

describe('browser tRPC client write idempotency', () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    return trpcResponse({ subscribed: true }, String(input).includes('batch=1'));
  });

  beforeEach(() => {
    window.localStorage.clear();
    clearCachedReadAuthHeaders();
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    clearCachedReadAuthHeaders();
    vi.unstubAllGlobals();
  });

  it('sends an unbatched idempotency key on every write, and a fresh one per operation', async () => {
    const client = makeTrpcClient();
    const input = { email: 'someone@example.com' };

    await client.taskDrops.subscribeOfficial.mutate(input);
    await client.taskDrops.subscribeOfficial.mutate(input);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('batch=1');
    const first = headersFor(fetchMock.mock.calls[0] ?? []).get(IDEMPOTENCY_KEY_HEADER);
    const second = headersFor(fetchMock.mock.calls[1] ?? []).get(IDEMPOTENCY_KEY_HEADER);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(second).not.toBe(first);
  });

  it('reuses a caller-supplied key so a retry of one operation stays one operation', async () => {
    const client = makeTrpcClient();
    const input = { email: 'someone@example.com' };
    const context = { [IDEMPOTENCY_CONTEXT_KEY]: 'key-for-one-operation' };

    await client.taskDrops.subscribeOfficial.mutate(input, { context });
    await client.taskDrops.subscribeOfficial.mutate(input, { context });

    expect(headersFor(fetchMock.mock.calls[0] ?? []).get(IDEMPOTENCY_KEY_HEADER)).toBe(
      'key-for-one-operation'
    );
    expect(headersFor(fetchMock.mock.calls[1] ?? []).get(IDEMPOTENCY_KEY_HEADER)).toBe(
      'key-for-one-operation'
    );
  });
});
