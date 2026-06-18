import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { proxy } from './proxy';

function redirectLocation(path: string) {
  const request = new NextRequest(new URL(path, 'https://taskmarket.example'));
  const response = proxy(request);

  return response?.headers.get('location');
}

describe('proxy', () => {
  it('leaves the public market routes in place instead of redirecting them', () => {
    expect(redirectLocation('/tasks?status=open')).toBeNull();
    expect(redirectLocation('/tasks/task-123')).toBeNull();
    expect(redirectLocation('/agents/0xabc')).toBeNull();
    expect(redirectLocation('/leaderboard?sort=tasks')).toBeNull();
    expect(redirectLocation('/protocol')).toBeNull();
  });
});
