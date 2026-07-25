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

  it('provides dynamic viewport and safe-area utilities for mobile surfaces', () => {
    const source = readFileSync('app/globals.css', 'utf8');

    expect(source).toContain('--app-viewport-height: 100vh;');
    expect(source).toContain('@supports (height: 100dvh)');
    expect(source).toContain('--app-viewport-height: 100dvh;');
    expect(source).toContain('--safe-area-inset-top: env(safe-area-inset-top, 0px);');
    expect(source).toContain('--safe-area-inset-right: env(safe-area-inset-right, 0px);');
    expect(source).toContain('--safe-area-inset-bottom: env(safe-area-inset-bottom, 0px);');
    expect(source).toContain('--safe-area-inset-left: env(safe-area-inset-left, 0px);');
    expect(source).toContain('.h-app-viewport');
    expect(source).toContain('.max-h-app-viewport');
    expect(source).toContain('.min-h-app-viewport');
    expect(source).toContain('.safe-area-top');
    expect(source).toContain('.safe-area-right');
    expect(source).toContain('.safe-area-bottom');
    expect(source).toContain('.safe-area-left');
    expect(source).toContain('.safe-area-sticky-bottom');
  });
});
