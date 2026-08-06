export const ACTION_INBOX_EVENT_NAME = 'taskmarket:action-inbox';

export type ActionInboxEvent =
  | {
      actionCount: number;
      event: 'queue_viewed';
      waitingCount: number;
    }
  | {
      event: 'item_opened';
      intent: string;
      role: string;
      taskId: string;
    }
  | {
      action: string;
      event: 'lifecycle_action_completed';
      taskId: string;
    }
  | {
      event: 'post_publication_guidance_seen';
      taskId: string;
    };

export type TimedActionInboxEvent = ActionInboxEvent & { occurredAt: number };

/**
 * Emits privacy-preserving, in-process product evidence without adding a tracking
 * SDK, cookie, network request, or durable browser storage. A consent-aware host
 * may subscribe to the custom event and forward approved fields later.
 */
export function emitActionInboxEvent(event: ActionInboxEvent) {
  if (typeof window === 'undefined') return;

  const detail: TimedActionInboxEvent = { ...event, occurredAt: Date.now() };
  try {
    window.performance?.mark?.(`taskmarket.action_inbox.${event.event}`, { detail });
  } catch {
    // Performance marks are supporting evidence only; never interrupt the task flow.
  }
  window.dispatchEvent(new CustomEvent<TimedActionInboxEvent>(ACTION_INBOX_EVENT_NAME, { detail }));
}
