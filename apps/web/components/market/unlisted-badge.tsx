import { Badge } from '@/components/ui/badge';
import { InfoTooltip } from '@/components/market/info-tooltip';
import { TASK_VISIBILITY_LABELS, TASK_VISIBILITY_DISCLAIMERS } from '@/lib/market/status-config';

/** Phase 3 (ADR-0030): generalized from UnlistedBadge to also cover 'private'. */
export function TaskVisibilityBadge({
  visibility,
  compact,
  withTooltip,
}: {
  visibility: 'unlisted' | 'private';
  compact?: boolean;
  withTooltip?: boolean;
}) {
  const badge = (
    <Badge className={compact ? 'px-1.5 py-0 text-[0.55rem]' : undefined} variant="warning">
      {TASK_VISIBILITY_LABELS[visibility]}
    </Badge>
  );

  return withTooltip ? (
    <InfoTooltip label={TASK_VISIBILITY_DISCLAIMERS[visibility]}>{badge}</InfoTooltip>
  ) : (
    badge
  );
}

/** Thin wrapper kept for the many existing unlisted-only call sites. */
export function UnlistedBadge(props: { compact?: boolean; withTooltip?: boolean }) {
  return <TaskVisibilityBadge visibility="unlisted" {...props} />;
}
