import { describe, expect, it, vi } from 'vitest';
import { TaskmarketClient, TaskmarketUnavailableError } from '../src/services/taskmarket-client';

describe('Taskmarket public client failures', () => {
  it('converts upstream server errors into a safe unavailable error', async () => {
    const client = new TaskmarketClient(
      'https://api.taskmarket.dev',
      vi.fn().mockResolvedValue(new Response('failure', { status: 503 }))
    );

    await expect(client.getTask('task-1')).rejects.toBeInstanceOf(TaskmarketUnavailableError);
  });

  it('aborts an upstream request at the configured deadline', async () => {
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });
    const client = new TaskmarketClient('https://api.taskmarket.dev', fetchMock, 1);

    await expect(client.getTask('task-1')).rejects.toBeInstanceOf(TaskmarketUnavailableError);
  });
});
