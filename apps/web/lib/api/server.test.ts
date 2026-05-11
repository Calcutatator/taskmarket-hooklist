import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiConnectionError, fetchTasks } from './server';

describe('server API fetchers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws a connection error instead of hiding a failed task list request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unavailable', { status: 503 }))
    );

    await expect(fetchTasks({ limit: 20 })).rejects.toMatchObject({
      name: 'ApiConnectionError',
      status: 503,
    } satisfies Partial<ApiConnectionError>);
  });

  it('returns task list data when the backend responds successfully', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ hasMore: false, nextCursor: null, tasks: [] }), {
            headers: { 'content-type': 'application/json' },
            status: 200,
          })
      )
    );

    await expect(fetchTasks({ limit: 20 })).resolves.toEqual({
      hasMore: false,
      nextCursor: null,
      tasks: [],
    });
  });

  it('does not wrap Next dynamic rendering signals from fetch', async () => {
    const dynamicServerError = Object.assign(new Error('Dynamic server usage'), {
      digest: 'DYNAMIC_SERVER_USAGE',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw dynamicServerError;
      })
    );

    await expect(fetchTasks({ limit: 20 })).rejects.toBe(dynamicServerError);
  });
});
