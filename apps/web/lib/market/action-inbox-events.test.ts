import { describe, expect, it, vi } from 'vitest';

import {
  ACTION_INBOX_EVENT_NAME,
  emitActionInboxEvent,
  type TimedActionInboxEvent,
} from './action-inbox-events';

describe('Action Inbox events', () => {
  it('emits a timed in-process event and performance mark without network storage', () => {
    const listener = vi.fn<(event: Event) => void>();
    const mark = vi.spyOn(window.performance, 'mark');
    window.addEventListener(ACTION_INBOX_EVENT_NAME, listener);

    emitActionInboxEvent({
      event: 'item_opened',
      intent: 'review_work',
      role: 'requester',
      taskId: 'task-1',
    });

    expect(listener).toHaveBeenCalledOnce();
    const detail = (listener.mock.calls[0]?.[0] as CustomEvent<TimedActionInboxEvent>).detail;
    expect(detail).toEqual(
      expect.objectContaining({
        event: 'item_opened',
        intent: 'review_work',
        taskId: 'task-1',
        occurredAt: expect.any(Number),
      })
    );
    expect(mark).toHaveBeenCalledWith(
      'taskmarket.action_inbox.item_opened',
      expect.objectContaining({ detail })
    );

    window.removeEventListener(ACTION_INBOX_EVENT_NAME, listener);
  });
});
