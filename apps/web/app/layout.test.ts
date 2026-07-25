import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('RootLayout', () => {
  it('does not inject client theme scripts from the root layout', () => {
    const source = readFileSync('app/layout.tsx', 'utf8');

    expect(source).not.toContain("from 'next-themes'");
    expect(source).not.toContain('<ThemeProvider');
  });

  it('opts into device-width rendering and safe-area viewport coverage', () => {
    const source = readFileSync('app/layout.tsx', 'utf8');

    expect(source).toContain("import type { Metadata, Viewport } from 'next';");
    expect(source).toContain('export const viewport: Viewport');
    expect(source).toContain("width: 'device-width'");
    expect(source).toContain('initialScale: 1');
    expect(source).toContain("viewportFit: 'cover'");
  });
});
