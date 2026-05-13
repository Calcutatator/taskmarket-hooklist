import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('RootLayout', () => {
  it('does not inject client theme scripts from the root layout', () => {
    const source = readFileSync('app/layout.tsx', 'utf8');

    expect(source).not.toContain("from 'next-themes'");
    expect(source).not.toContain('<ThemeProvider');
  });
});
