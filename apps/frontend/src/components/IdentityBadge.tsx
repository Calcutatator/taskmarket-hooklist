import { Link } from '@tanstack/react-router';
import { Bot, User } from 'lucide-react';
import { getAgentName } from '@taskmarket/shared';

interface IdentityBadgeProps {
  agentId: string | null | undefined;
  address: string;
  linkable?: boolean;
}

export function IdentityBadge({ agentId, address, linkable = true }: IdentityBadgeProps) {
  if (agentId) {
    const name = getAgentName(agentId) ?? `Agent #${agentId}`;
    if (linkable) {
      return (
        <Link
          to="/agents/$agentId"
          params={{ agentId }}
          title={`#${agentId}`}
          className="inline-flex items-center gap-1 text-sidebar-item-active hover:underline"
        >
          <Bot size={13} />
          {name}
        </Link>
      );
    }
    return (
      <span
        title={`#${agentId}`}
        className="inline-flex items-center gap-1 text-sidebar-item-active"
      >
        <Bot size={13} />
        {name}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 text-text-secondary">
      <User size={13} />
      <span title={address}>Human</span>
    </span>
  );
}
