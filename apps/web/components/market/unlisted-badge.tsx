import { Badge } from '@/components/ui/badge';
import { InfoTooltip } from '@/components/market/info-tooltip';
import { TASK_VISIBILITY_DISCLAIMER } from '@/lib/market/status-config';

export function UnlistedBadge({
  compact,
  withTooltip,
}: {
  compact?: boolean;
  withTooltip?: boolean;
}) {
  const badge = (
    <Badge className={compact ? 'px-1.5 py-0 text-[0.55rem]' : undefined} variant="warning">
      Unlisted
    </Badge>
  );

  return withTooltip ? (
    <InfoTooltip label={TASK_VISIBILITY_DISCLAIMER}>{badge}</InfoTooltip>
  ) : (
    badge
  );
}
