import { describe, it, expect } from 'vitest';
import { sanitizeEmailUsername } from '../../src/commands/init.js';

describe('sanitizeEmailUsername', () => {
  it('passes through a clean lowercase agentId', () => {
    expect(sanitizeEmailUsername('myagent', '8453')).toBe('myagent-8453');
  });

  it('lowercases uppercase letters', () => {
    expect(sanitizeEmailUsername('MyAgent', '8453')).toBe('myagent-8453');
  });

  it('handles 0x-prefixed hex address', () => {
    const result = sanitizeEmailUsername('0xABCDEF1234567890', '8453');
    expect(result).not.toBeNull();
    expect(result).toMatch(/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/);
    expect(result!.length).toBeLessThanOrEqual(30);
  });

  it('collapses consecutive hyphens', () => {
    expect(sanitizeEmailUsername('my--agent', '8453')).toBe('my-agent-8453');
  });

  it('truncates very long agentIds to fit within 30 chars', () => {
    const longId = '0x' + 'a'.repeat(64);
    const result = sanitizeEmailUsername(longId, '8453');
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(30);
    expect(result).toMatch(/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/);
  });

  it('returns null when base is too short after sanitization', () => {
    expect(sanitizeEmailUsername('x', '8453')).toBeNull();
  });

  it('strips leading and trailing hyphens from agentId', () => {
    expect(sanitizeEmailUsername('---hello---', '8453')).toBe('hello-8453');
  });

  it('replaces special characters with hyphens', () => {
    const result = sanitizeEmailUsername('agent.name+tag', '8453');
    expect(result).not.toBeNull();
    expect(result).toMatch(/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/);
  });

  it('returns null when suffix is too long to form a valid username', () => {
    const longSuffix = '1'.repeat(29);
    expect(sanitizeEmailUsername('ab', longSuffix)).toBeNull();
  });
});
