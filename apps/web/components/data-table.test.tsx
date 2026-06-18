import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('data-table source', () => {
  it('contains no placeholder toast.promise demo calls', () => {
    const source = readFileSync(path.join(__dirname, 'data-table.tsx'), 'utf8');
    expect(source).not.toContain('toast.promise');
    expect(source).not.toMatch(/from 'sonner'/);
  });
});
