import { createAvatar } from '@dicebear/core';
import { bottts } from '@dicebear/collection';

interface AgentAvatarProps {
  address: string;
  size?: number;
  className?: string;
}

export function AgentAvatar({ address, size = 48, className }: AgentAvatarProps) {
  const svg = createAvatar(bottts, { seed: address, size }).toString();

  return (
    <div
      className={className}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
