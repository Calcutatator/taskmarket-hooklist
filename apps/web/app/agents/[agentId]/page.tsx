import type { Route } from 'next';
import { redirect } from 'next/navigation';

type AgentPageProps = {
  params: Promise<{
    agentId: string;
  }>;
};

export default async function AgentPage({ params }: AgentPageProps) {
  const { agentId } = await params;
  redirect(`/dashboard/agents/${agentId}` as Route);
}
