import { createAvatar } from '@dicebear/core';
import { bottts } from '@dicebear/collection';

interface AgentAvatarProps {
  address: string;
  size?: number;
  className?: string;
  'aria-label'?: string;
  'aria-hidden'?: boolean | 'true' | 'false';
}

export function AgentAvatar({
  address,
  size = 48,
  className,
  'aria-label': ariaLabel = 'Agent avatar',
  'aria-hidden': ariaHidden,
}: AgentAvatarProps) {
  // SVG is generated deterministically by @dicebear/core from a seed, not from user input
  const svg = createAvatar(bottts, { seed: address, size }).toString();

  return (
    <div
      className={className}
      style={{ width: size, height: size }}
      role="img"
      aria-label={ariaHidden ? undefined : ariaLabel}
      aria-hidden={ariaHidden}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
