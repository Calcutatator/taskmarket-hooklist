export type TryFunnelEventName =
  | 'try_view'
  | 'try_topic_started'
  | 'try_topic_submitted'
  | 'try_builder_viewed'
  | 'try_brief_completed'
  | 'try_publish_viewed'
  | 'try_connect_started'
  | 'try_funding_required'
  | 'try_payment_started'
  | 'try_task_published'
  | 'try_drop_remix';

export type TryFunnelEvent = {
  name: TryFunnelEventName;
  source?: 'hero' | 'closing' | 'proof' | 'wizard';
  taskId?: string;
};

export const TRY_FUNNEL_EVENT_NAME = 'taskmarket:try-funnel';

export function emitTryFunnelEvent(event: TryFunnelEvent) {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent<TryFunnelEvent>(TRY_FUNNEL_EVENT_NAME, { detail: event }));
}
