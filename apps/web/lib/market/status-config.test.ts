import { TaskMode, TaskStatus } from '@taskmarket/shared';
import { describe, expect, it } from 'vitest';

import {
  getStatusConfig,
  METRIC_LEGENDS,
  MODE_TOOLTIPS,
  STATUS_CONFIG,
  type StatusPhase,
} from './status-config';

const VALID_PHASES: StatusPhase[] = ['workable', 'in-progress', 'closed'];

describe('STATUS_CONFIG', () => {
  it('maps every canonical status to a non-empty label, description, and valid phase', () => {
    for (const status of TaskStatus.options) {
      const entry = STATUS_CONFIG[status];
      expect(entry, `missing config for status ${status}`).toBeDefined();
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
      expect(VALID_PHASES).toContain(entry.phase);
    }
  });

  it('classifies terminal statuses as closed', () => {
    expect(STATUS_CONFIG.completed.phase).toBe('closed');
    expect(STATUS_CONFIG.expired.phase).toBe('closed');
    expect(STATUS_CONFIG.cancelled.phase).toBe('closed');
  });

  it('classifies open as workable', () => {
    expect(STATUS_CONFIG.open.phase).toBe('workable');
  });

  it('classifies in-flight decisions as in-progress', () => {
    expect(STATUS_CONFIG.review.phase).toBe('in-progress');
    expect(STATUS_CONFIG.appealing.phase).toBe('in-progress');
    expect(STATUS_CONFIG.disputed.phase).toBe('in-progress');
  });

  it('uses the curated human labels for renamed statuses', () => {
    expect(STATUS_CONFIG.pending_approval.label).toBe('Awaiting buyer review');
    expect(STATUS_CONFIG.review.label).toBe('Judging');
  });
});

describe('getStatusConfig', () => {
  it('returns the curated entry for a known status', () => {
    expect(getStatusConfig('pending_approval')).toEqual(STATUS_CONFIG.pending_approval);
  });

  it('falls back to a titleized label and in-progress phase for unknown statuses', () => {
    const result = getStatusConfig('some_new_state');
    expect(result.label).toBe('Some new state');
    expect(result.phase).toBe('in-progress');
    expect(result.description.length).toBeGreaterThan(0);
  });

  it('handles an empty status string without throwing', () => {
    const result = getStatusConfig('');
    expect(result.phase).toBe('in-progress');
    expect(result.label.length).toBeGreaterThan(0);
  });
});

describe('MODE_TOOLTIPS', () => {
  it('provides a non-empty tooltip for every canonical mode', () => {
    for (const mode of TaskMode.options) {
      expect(MODE_TOOLTIPS[mode], `missing tooltip for mode ${mode}`).toBeDefined();
      expect(MODE_TOOLTIPS[mode].length).toBeGreaterThan(0);
    }
  });
});

describe('METRIC_LEGENDS', () => {
  it('explains the rating and credibility metrics', () => {
    expect(METRIC_LEGENDS.rating).toBeDefined();
    expect(METRIC_LEGENDS.rating).toContain('0-100');
    expect(METRIC_LEGENDS.credibility).toBeDefined();
    expect(METRIC_LEGENDS.credibility.length).toBeGreaterThan(0);
  });
});
