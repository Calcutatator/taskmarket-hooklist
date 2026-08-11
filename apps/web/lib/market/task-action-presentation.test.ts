import type { TaskActionIntentValue } from '@taskmarket/shared';
import { describe, expect, it } from 'vitest';

import {
  TASK_ACTION_PRESENTATION,
  taskActionHref,
  taskActionTitle,
} from './task-action-presentation';

const anchors: Record<TaskActionIntentValue, string> = {
  appeal_verdict: 'task-verdict',
  evaluate_work: 'task-activity',
  finalize_verdict: 'task-verdict',
  rate_workers: 'settlement-payouts',
  resolve_dispute: 'task-activity',
  review_work: 'task-activity',
  select_auction_winner: 'task-activity',
  select_worker: 'task-activity',
  settle_expired: 'task-next-actions',
  submit_work: 'task-participation',
};

describe('task action presentation', () => {
  it('maps every intent to one evidence-aware destination and focus label', () => {
    for (const [intent, anchor] of Object.entries(anchors) as [TaskActionIntentValue, string][]) {
      expect(TASK_ACTION_PRESENTATION[intent].anchor).toBe(anchor);
      expect(TASK_ACTION_PRESENTATION[intent].description).not.toHaveLength(0);
      expect(TASK_ACTION_PRESENTATION[intent].focusLabel).not.toHaveLength(0);
      expect(taskActionHref('/dashboard/tasks/', 'task/with spaces', intent)).toBe(
        `/dashboard/tasks/task%2Fwith%20spaces?focus=${intent}#${anchor}`
      );
    }
  });

  it('uses progress to describe grouped work without duplicating title maps', () => {
    expect(taskActionTitle('review_work', { completed: 0, total: 3 })).toBe('Review 3 submissions');
    expect(taskActionTitle('select_worker', { completed: 0, total: 2 })).toBe(
      'Compare 2 pitches and select a worker'
    );
    expect(taskActionTitle('rate_workers', { completed: 1, total: 3 })).toBe('Rate 2 workers');
    expect(taskActionTitle('rate_workers', { completed: 2, total: 3 })).toBe('Rate the worker');
  });
});
