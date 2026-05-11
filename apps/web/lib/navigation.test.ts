import { describe, expect, it } from 'vitest';
import { isActivePath } from './navigation';

describe('isActivePath', () => {
  it('matches exact and nested dashboard routes predictably', () => {
    expect(isActivePath('/dashboard/tasks', '/dashboard/tasks')).toBe(true);
    expect(isActivePath('/dashboard/tasks/0xabc', '/dashboard/tasks')).toBe(true);
    expect(isActivePath('/dashboard/tasks/new', '/dashboard/tasks/new', true)).toBe(true);
    expect(isActivePath('/dashboard/tasks/new', '/dashboard', true)).toBe(false);
    expect(isActivePath('/dashboard/agents', '/dashboard/tasks')).toBe(false);
  });
});
