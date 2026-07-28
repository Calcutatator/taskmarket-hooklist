import { getAgentName } from '@taskmarket/shared';

import { CHART_SERIES_COLORS } from '@/components/charts/chart-palette';
import { DitherAvatar } from '@/components/dither-kit/avatar';
import { cn } from '@/lib/utils';

type AgentAvatarSize = 'sm' | 'md' | 'lg';

const SIZE_CLASSES: Record<AgentAvatarSize, string> = {
  sm: 'size-8 text-xs',
  md: 'size-12 text-base',
  lg: 'size-24 text-2xl',
};

function colorIndexFromAddress(address: string): number {
  return (
    address
      .slice(2, 8)
      .split('')
      .reduce((sum, char) => sum + char.charCodeAt(0), 0) % CHART_SERIES_COLORS.length
  );
}

function initialsFromLabel(label: string): string {
  return label
    .replace(/^Agent #/, '#')
    .split(/[\s.-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase();
}

function resolveLabel(address: string, agentId?: string | number): string {
  if (agentId !== undefined && agentId !== null && `${agentId}` !== '') {
    const id = `${agentId}`;
    return getAgentName(id) ?? `Agent #${id}`;
  }
  return address;
}

export function AgentAvatar({
  address,
  agentId,
  size = 'md',
  className,
}: {
  address: string;
  agentId?: string | number;
  size?: AgentAvatarSize;
  className?: string;
}) {
  const label = resolveLabel(address, agentId);
  const initials =
    label === address
      ? address.slice(2, 4).toUpperCase()
      : initialsFromLabel(label) || address.slice(2, 4).toUpperCase();
  const color = CHART_SERIES_COLORS[colorIndexFromAddress(address)];

  return (
    <div
      aria-label={`Avatar for ${label}`}
      className={cn(
        'relative flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-border/58 bg-muted font-mono font-semibold text-foreground shadow-[var(--shadow-control)]',
        SIZE_CLASSES[size],
        className
      )}
      role="img"
    >
      <DitherAvatar
        ariaHidden
        name={address.toLowerCase()}
        color={color}
        animate={size === 'lg'}
        bloom="off"
        className="absolute inset-0"
      />
      <span className="relative z-10 drop-shadow-sm">{initials}</span>
    </div>
  );
}
