import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('button source', () => {
  it('uses height-proportional squircle corners with a rounded fallback', () => {
    const source = readFileSync(path.join(__dirname, 'button.tsx'), 'utf8');

    expect(source).toContain('rounded-[var(--button-radius)]');
    expect(source).toContain('[corner-shape:squircle]');
    expect(source).toContain('[--button-radius:1.125rem]');
    expect(source).toContain('sm:[--button-radius:1.0625rem]');
    expect(source).toContain("before:content-['']");
    expect(source).toContain('before:[corner-shape:inherit]');
    expect(source).toContain('before:[background:radial-gradient(');
    expect(source).toContain('border-transparent bg-transparent text-foreground before:hidden');
    expect(source).not.toContain('gap-2 rounded-full border');
  });

  it('keeps compact buttons touch-sized on mobile and honors their desktop heights', () => {
    const source = readFileSync(path.join(__dirname, 'button.tsx'), 'utf8');

    expect(source).toContain(
      "'min-h-11 [--button-radius:1.125rem] px-4 py-2 has-[>svg]:px-3.5 sm:h-10 sm:min-h-0 sm:[--button-radius:1.0625rem]'"
    );
    expect(source).toContain(
      "sm: 'min-h-11 [--button-radius:1.125rem] gap-1.5 px-3.5 has-[>svg]:px-3 sm:h-9 sm:min-h-0 sm:[--button-radius:0.9375rem]'"
    );
    expect(source).toContain('sm:h-7 sm:min-h-0');
    expect(source).toContain('sm:h-9 sm:min-h-0');
  });

  it('uses a 44px touch target for icon-xs below the md breakpoint', () => {
    const source = readFileSync(path.join(__dirname, 'button.tsx'), 'utf8');
    expect(source).toContain(
      "'icon-xs':\n          \"size-11 [--button-radius:1.125rem] md:size-7"
    );
    expect(source).not.toContain('size-11 sm:size-7');
  });

  it('keeps mobile navigation rows and dismiss controls at least 44px', () => {
    const sidebar = readFileSync(path.join(__dirname, 'sidebar.tsx'), 'utf8');
    const sheet = readFileSync(path.join(__dirname, 'sheet.tsx'), 'utf8');
    const dialog = readFileSync(path.join(__dirname, 'dialog.tsx'), 'utf8');

    expect(sidebar).toContain("default: 'min-h-11 text-sm md:h-8 md:min-h-0'");
    expect(sidebar).toContain("sm: 'min-h-11 text-xs md:h-7 md:min-h-0'");
    expect(sheet).toContain('inline-flex size-11');
    expect(sheet).toContain('sm:size-8');
    expect(sheet).toContain('var(--safe-area-inset-bottom)');
    expect(dialog).toContain('inline-flex size-11');
    expect(dialog).toContain('sm:size-8');
    expect(dialog).toContain('safe-area-dialog-surface');
  });
});
