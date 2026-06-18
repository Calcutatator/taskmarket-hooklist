import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('PublicLayout', () => {
  it('exposes a skip link and a focusable main landmark', () => {
    const webRoot = process.cwd().endsWith('/apps/web')
      ? process.cwd()
      : join(process.cwd(), 'apps/web');
    const source = readFileSync(join(webRoot, 'app/(public)/layout.tsx'), 'utf8');

    expect(source).toContain('href="#main-content"');
    expect(source).toContain('id="main-content"');
    expect(source).toContain('tabIndex={-1}');
    expect(source).toContain('PublicSiteHeader');
    expect(source).toContain('PublicSiteFooter');
  });
});
