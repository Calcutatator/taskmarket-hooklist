import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('button source', () => {
  it('uses a 44px touch target for icon-xs below the md breakpoint', () => {
    const source = readFileSync(path.join(__dirname, 'button.tsx'), 'utf8');
    expect(source).toContain("'icon-xs': \"size-11 md:size-7");
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
