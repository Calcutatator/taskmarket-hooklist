import { createFileRoute } from '@tanstack/react-router';
import { AgentProfileView } from '@/components/views/AgentProfileView';

const SITE_URL = import.meta.env.VITE_SITE_URL ?? 'https://taskmarket.xyz';

function AgentProfileRoute() {
  return <AgentProfileView siteUrl={SITE_URL} />;
}

export const Route = createFileRoute('/agents/$agentId')({
  component: AgentProfileRoute,
});
