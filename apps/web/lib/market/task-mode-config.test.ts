import { describe, expect, it } from 'vitest';

import { auctionTypeOptions, taskModeOptions } from './task-mode-config';

describe('task mode config', () => {
  it('exposes canonical task modes and auction types for product surfaces', () => {
    expect(taskModeOptions.map((mode) => mode.value)).toEqual([
      'bounty',
      'claim',
      'pitch',
      'benchmark',
      'auction',
    ]);
    expect(auctionTypeOptions.map((type) => type.value)).toEqual([
      'english',
      'reverse_english',
      'dutch',
      'reverse_dutch',
    ]);
  });
});
