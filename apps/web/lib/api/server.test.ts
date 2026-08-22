import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ApiConnectionError,
  fetchHook,
  fetchHookIndex,
  fetchTaskDropDirectory,
  fetchTasks,
} from './server';

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

  it('uses bounded Hooklist and dedicated address endpoints', async () => {
    const hook = {
      activePhaseTaskCount: 1,
      address: '0x1111111111111111111111111111111111111111',
      modes: ['bounty'],
      taskCount: 9,
      taskIds: ['task-9'],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            hasMore: true,
            hooks: [hook],
            observation: 'current-task-projection-one-effective-hook-per-task',
          }),
          {
            headers: { 'content-type': 'application/json' },
            status: 200,
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(hook), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchHookIndex({ limit: 25 })).resolves.toMatchObject({ hasMore: true });
    await expect(fetchHook(hook.address)).resolves.toEqual(hook);

    expect(new URL(String(fetchMock.mock.calls[0]![0])).searchParams.get('limit')).toBe('25');
    expect(new URL(String(fetchMock.mock.calls[1]![0])).pathname).toBe(
      `/api/hooks/${hook.address}`
    );
  });

  it('returns null when the hook endpoint fulfills its nullable 200 contract', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(null), {
            headers: { 'content-type': 'application/json' },
            status: 200,
          })
      )
    );

    await expect(fetchHook('0x1111111111111111111111111111111111111111')).resolves.toBeNull();
  });

  it('does not mistake an HTTP 404 for the nullable missing-hook response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not found', { status: 404 }))
    );

    await expect(fetchHook('0x1111111111111111111111111111111111111111')).rejects.toMatchObject({
      name: 'ApiConnectionError',
      status: 404,
    } satisfies Partial<ApiConnectionError>);
  });

  it('preserves hook endpoint availability failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unavailable', { status: 503 }))
    );

    await expect(fetchHook('0x1111111111111111111111111111111111111111')).rejects.toMatchObject({
      name: 'ApiConnectionError',
      status: 503,
    } satisfies Partial<ApiConnectionError>);
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

  it('fetches a cursor page from the public Task Drop directory', async () => {
    const responseBody = {
      items: [],
      nextCursor: 'next/drop',
    };
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(responseBody), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchTaskDropDirectory({ cursor: 'current/drop', limit: 24 })).resolves.toEqual(
      responseBody
    );

    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    const requestUrl = new URL(String(firstCall![0]));
    expect(requestUrl.pathname).toBe('/api/task-drops/directory');
    expect(requestUrl.searchParams.get('cursor')).toBe('current/drop');
    expect(requestUrl.searchParams.get('limit')).toBe('24');
  });
});
