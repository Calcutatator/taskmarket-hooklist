import { getAgentName } from '@taskmarket/shared';

import { cn } from '@/lib/utils';

// Standalone, dependency-free agent avatar. Renders a deterministic gradient mark
// (hue derived from the address) with the agent's initials, extracted from the inline
// AgentMark in components/market/agents.tsx so listing rows, cards, and the profile
// header share one identity glyph. No avatar libraries - the gradient + initials are
// computed locally and are stable for a given address/label.

type AgentAvatarSize = 'sm' | 'md' | 'lg';

const SIZE_CLASSES: Record<AgentAvatarSize, string> = {
  sm: 'size-8 text-xs',
  md: 'size-12 text-base',
  lg: 'size-24 text-2xl',
};

// Sum the char codes of the first bytes of the address into a stable hue. Matches the
// derivation in agents.tsx so the same address keeps the same colour everywhere.
function hueFromAddress(address: string): number {
  return address
    .slice(2, 8)
    .split('')
    .reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

// Up to two initials from a human label, stripping the "Agent #" prefix so numeric ids
// read as "#". Matches the derivation in agents.tsx.
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

// Resolve the display label the same way agents.tsx does: prefer a named agent, then
// "Agent #<id>", then a shortened address.
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
  const hue = hueFromAddress(address);
  const initials = initialsFromLabel(label) || address.slice(2, 4).toUpperCase();

  return (
    <div
      aria-label={`Avatar for ${label}`}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full border border-border/58 font-mono font-semibold text-foreground shadow-[var(--shadow-control)]',
        SIZE_CLASSES[size],
        className
      )}
      role="img"
      style={{
        background: `linear-gradient(135deg, hsl(${hue % 360} 28% 24%), hsl(${(hue + 48) % 360} 42% 38%))`,
      }}
    >
      {initials}
    </div>
  );
}
