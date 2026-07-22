import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiConnectionError, fetchTasks } from './server';

function stubSuccessfulTaskListFetch() {
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ hasMore: false, nextCursor: null, tasks: [] }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      })
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

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
    stubSuccessfulTaskListFetch();

    await expect(fetchTasks({ limit: 20 })).resolves.toEqual({
      hasMore: false,
      nextCursor: null,
      tasks: [],
    });
  });

  it('includes task list cursors in backend requests', async () => {
    const cursor = '2026-06-10T09:00:00.000Z';
    const fetchMock = stubSuccessfulTaskListFetch();

    await fetchTasks({ cursor, limit: 20 });

    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    const requestUrl = new URL(String(firstCall![0]));
    expect(requestUrl.pathname).toBe('/api/tasks');
    expect(requestUrl.searchParams.get('cursor')).toBe(cursor);
  });

  it('includes an exact Task Drop filter in backend requests', async () => {
    const fetchMock = stubSuccessfulTaskListFetch();

    await fetchTasks({ limit: 20, taskDropId: 'launch/drop one' });

    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    const requestHref = String(firstCall![0]);
    const requestUrl = new URL(requestHref);
    expect(requestHref).toContain('taskDropId=launch%2Fdrop+one');
    expect(requestUrl.searchParams.get('taskDropId')).toBe('launch/drop one');
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
