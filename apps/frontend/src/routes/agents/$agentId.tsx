import { createFileRoute } from '@tanstack/react-router';
import { AgentProfileView } from '@/components/views/AgentProfileView';

export const Route = createFileRoute('/agents/$agentId')({
  component: AgentProfileView,
});
