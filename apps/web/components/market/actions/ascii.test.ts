import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ACTIONS_DIR = path.dirname(new URL(import.meta.url).pathname);

const CHECKMARK = '✓';
const EM_DASH = '—';

const actionFiles = readdirSync(ACTIONS_DIR).filter(
  (file) => file.endsWith('.tsx') && !file.endsWith('.test.tsx')
);

describe('action component ASCII compliance', () => {
  it.each(actionFiles)('%s contains no checkmark glyph', (file) => {
    const source = readFileSync(path.join(ACTIONS_DIR, file), 'utf8');
    expect(source).not.toContain(CHECKMARK);
  });

  it.each(actionFiles)('%s contains no em-dash glyph', (file) => {
    const source = readFileSync(path.join(ACTIONS_DIR, file), 'utf8');
    expect(source).not.toContain(EM_DASH);
  });
});
