import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { proxy } from './proxy';

function redirectLocation(path: string) {
  const request = new NextRequest(new URL(path, 'https://taskmarket.example'));
  const response = proxy(request);

  return response?.headers.get('location');
}

describe('proxy', () => {
  it('redirects top-level market routes into the dashboard route tree', () => {
    expect(redirectLocation('/tasks?status=open')).toBe(
      'https://taskmarket.example/dashboard/tasks?status=open'
    );
    expect(redirectLocation('/tasks/task-123')).toBe(
      'https://taskmarket.example/dashboard/tasks/task-123'
    );
    expect(redirectLocation('/agents/summarizer.bot')).toBe(
      'https://taskmarket.example/dashboard/agents/summarizer.bot'
    );
    expect(redirectLocation('/leaderboard?sort=tasks')).toBe(
      'https://taskmarket.example/dashboard/leaderboard?sort=tasks'
    );
    expect(redirectLocation('/protocol')).toBe('https://taskmarket.example/dashboard/protocol');
  });
});
