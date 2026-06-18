import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('button source', () => {
  it('uses a 44px touch target for icon-xs below the md breakpoint', () => {
    const source = readFileSync(path.join(__dirname, 'button.tsx'), 'utf8');
    expect(source).toContain("'icon-xs': \"size-11 md:size-7");
    expect(source).not.toContain('size-11 sm:size-7');
  });
});
