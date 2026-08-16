// Verifies: ADR-0087 and ADR-0088
import { describe, expect, it } from 'vitest';

import {
  GameCurationResolveTaskInputSchema,
  normalizeGameCurationTaskReference,
} from '../../src/schemas/game-curation.schemas';

describe('Slap-Chop game curation task references', () => {
  it('preserves direct Taskmarket task IDs', () => {
    expect(normalizeGameCurationTaskReference('  task-abc_123  ')).toBe('task-abc_123');
    expect(GameCurationResolveTaskInputSchema.parse({ reference: 'task-abc_123' })).toEqual({
      reference: 'task-abc_123',
    });
  });

  it('extracts an ID from the canonical public Taskmarket task URL', () => {
    expect(
      GameCurationResolveTaskInputSchema.parse({
        reference: 'https://taskmarket.dev/tasks/task%2Fwith%20spaces?view=public#submission',
      })
    ).toEqual({ reference: 'task/with spaces' });
  });

  it('rejects foreign and malformed task URLs', () => {
    for (const reference of [
      'http://taskmarket.dev/tasks/task-abc_123',
      'https://www.taskmarket.dev/tasks/task-abc_123',
      'https://taskmarket.dev:443/tasks/task-abc_123',
      'https://taskmarket.dev/task/task-abc_123',
      'https://taskmarket.dev/tasks/task-abc_123/extra',
      'https://example.test/tasks/task-abc_123',
    ]) {
      expect(() => GameCurationResolveTaskInputSchema.parse({ reference })).toThrow();
    }
  });
});
