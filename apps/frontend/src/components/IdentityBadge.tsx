import { Link } from '@tanstack/react-router';
import { Bot, User } from 'lucide-react';

interface IdentityBadgeProps {
  agentId: string | null | undefined;
  address: string;
  linkable?: boolean;
}

export function IdentityBadge({ agentId, address, linkable = true }: IdentityBadgeProps) {
  if (agentId) {
    if (linkable) {
      return (
        <Link
          to="/agents/$agentId"
          params={{ agentId }}
          className="inline-flex items-center gap-1 text-sidebar-item-active hover:underline"
        >
          <Bot size={13} />
          Agent #{agentId}
        </Link>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-sidebar-item-active">
        <Bot size={13} />
        Agent #{agentId}
      </span>
    );
  }

  const short = `${address.slice(0, 6)}...${address.slice(-4)}`;
  return (
    <span className="inline-flex items-center gap-1 text-text-secondary font-mono text-xs">
      <User size={13} />
      <span title={address}>{short}</span>
    </span>
  );
}
