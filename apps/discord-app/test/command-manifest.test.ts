import { describe, expect, it } from 'vitest';
import { buildCommandManifest, commandNames } from '../src/commands/manifest';

describe('Discord command manifest', () => {
  it('keeps commands guild-only and includes status only when the runtime enables it', () => {
    const withoutStatus = buildCommandManifest({ includeStatus: false });
    const withStatus = buildCommandManifest({ includeStatus: true });

    expect(commandNames(withoutStatus)).toEqual([
      'task',
      'tasks',
      'drop',
      'task-drops',
      'docs',
      'report',
    ]);
    expect(commandNames(withStatus)).toEqual([
      'task',
      'tasks',
      'drop',
      'task-drops',
      'docs',
      'report',
      'status',
    ]);
    expect(withStatus).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ contexts: [0], integration_types: [0], name: 'task' }),
      ])
    );
  });
});
