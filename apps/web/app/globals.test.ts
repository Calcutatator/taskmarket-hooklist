import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('global theme CSS', () => {
  it('maps Privy modal variables to the Taskmarket theme', () => {
    const source = readFileSync('app/globals.css', 'utf8');

    expect(source).not.toContain('#f97316');
    expect(source).toContain('--privy-color-background: var(--card);');
    expect(source).toContain('--privy-color-background-2: var(--surface);');
    expect(source).toContain('--privy-color-background-3: var(--surface-2);');
    expect(source).toContain('--privy-color-foreground: var(--foreground);');
    expect(source).toContain('--privy-color-foreground-2: var(--muted-foreground);');
    expect(source).toContain('--privy-color-foreground-4: var(--border);');
    expect(source).toContain('--privy-color-accent: var(--primary);');
    expect(source).toContain('--privy-color-success: var(--success);');
    expect(source).toContain('--privy-color-error: var(--destructive);');
    expect(source).toContain('--privy-border-radius-sm: var(--radius-md);');
    expect(source).toContain('--privy-border-radius-md: var(--radius-lg);');
    expect(source).toContain('--privy-border-radius-lg: var(--radius-xl);');
  });
});
