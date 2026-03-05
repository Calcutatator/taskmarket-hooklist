import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { Helmet } from 'react-helmet-async';
import { trpc } from '@/contexts/TRPCProvider';
import { formatUSDC } from '@/lib/format';
import { EXPLORER_URL, IDENTITY_REGISTRY, NETWORK_NAME } from '@/lib/chain';
import { getAgentName } from '@taskmarket/shared';
import { AgentAvatar } from '../AgentAvatar';
import { PageLayout } from '../layout/PageLayout';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Separator } from '../ui/separator';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <button
      onClick={handleCopy}
      aria-label="Copy"
      className="text-text-tertiary hover:text-text-primary transition-colors shrink-0"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    void navigator.clipboard.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <div className="flex items-center gap-2 text-xs">
      <code className="flex-1 bg-background-secondary px-2 py-1.5 rounded font-mono break-all">
        {command}
      </code>
      <button
        onClick={handleCopy}
        aria-label="Copy command"
        className="text-text-tertiary hover:text-text-primary transition-colors shrink-0"
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  );
}

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <Card className="h-full">
      <CardContent className="pt-6">
        <div className="text-2xl font-bold break-all">{value}</div>
        <div className="text-xs text-text-secondary mt-1">{label}</div>
      </CardContent>
    </Card>
  );
}

export function AgentProfileView({ siteUrl }: { siteUrl: string }) {
  const { agentId } = useParams({ from: '/agents/$agentId' });

  const { data: agent, isLoading } = trpc.agents.stats.useQuery({ agentId });

  const fallbackHelmet = (
    <Helmet>
      <title>Agent - Taskmarket</title>
      <meta property="og:title" content="Agent - Taskmarket" />
      <link rel="canonical" href={`${siteUrl}/agents/${agentId}`} />
    </Helmet>
  );

  if (isLoading) {
    return (
      <PageLayout>
        {fallbackHelmet}
        <div className="space-y-4">
          <div className="h-8 w-48 bg-background-secondary animate-pulse rounded" />
          <div className="h-32 bg-background-secondary animate-pulse rounded" />
        </div>
      </PageLayout>
    );
  }

  if (!agent) {
    return (
      <PageLayout>
        {fallbackHelmet}
        <p className="text-text-secondary">Agent not found.</p>
      </PageLayout>
    );
  }

  const explorerAddressUrl = `${EXPLORER_URL}/address/${agent.address}`;
  const explorerTokenUrl = agent.agentId
    ? `${EXPLORER_URL}/token/${IDENTITY_REGISTRY}?a=${agent.agentId}`
    : null;

  const agentName = agent.agentId
    ? (getAgentName(agent.agentId) ?? `Agent #${agent.agentId}`)
    : agentId;
  const agentLabel = agentName;
  const agentDesc = `${agent.completedTasks} tasks completed · Rating: ${agent.averageRating > 0 ? agent.averageRating.toFixed(1) : 'N/A'}${agent.skills && agent.skills.length > 0 ? ` · ${agent.skills.join(', ')}` : ''}`;

  return (
    <PageLayout>
      <Helmet>
        <title>{agentLabel} - Taskmarket</title>
        <meta name="description" content={agentDesc} />
        <meta property="og:title" content={`${agentLabel} on Taskmarket`} />
        <meta property="og:description" content={agentDesc} />
        <meta property="og:url" content={`${siteUrl}/agents/${agentId}`} />
        <meta property="og:image" content={`${siteUrl}/og-image.png`} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:locale" content="en_US" />
        <link rel="canonical" href={`${siteUrl}/agents/${agentId}`} />
        <meta name="twitter:title" content={`${agentLabel} on Taskmarket`} />
        <meta
          name="twitter:description"
          content={`${agent.completedTasks} tasks completed · Rating: ${agent.averageRating > 0 ? agent.averageRating.toFixed(1) : 'N/A'}`}
        />
        <meta name="twitter:image" content={`${siteUrl}/og-image.png`} />
      </Helmet>
      <div className="space-y-6">
        {/* Header: two columns, avatar left and vertically centered with text */}
        <div className="flex items-center gap-6">
          <div className="w-[120px] h-[120px] rounded-full ring-2 ring-border-primary flex items-center justify-center overflow-hidden shrink-0 bg-background-secondary">
            <AgentAvatar
              address={agent.address}
              size={88}
              className="rounded-full overflow-hidden"
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-mono text-text-secondary tracking-widest mb-1">AGENT</p>
            <h1 className="font-heading text-3xl font-bold mb-1">{agentName}</h1>
            {agent.agentId && (
              <p className="text-sm font-mono text-text-secondary mb-3">#{agent.agentId}</p>
            )}

            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-text-tertiary w-16 shrink-0">address</span>
                <span className="font-mono text-sm text-text-secondary break-all">
                  {agent.address}
                </span>
                <CopyButton text={agent.address} />
                <a
                  href={explorerAddressUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-text-tertiary hover:text-text-primary transition-colors shrink-0"
                  aria-label="View on BaseScan"
                >
                  <ExternalLink size={13} />
                </a>
              </div>

              {agent.agentId && (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-text-tertiary w-16 shrink-0">
                    erc-8004
                  </span>
                  <span className="font-mono text-sm text-text-secondary">
                    token #{agent.agentId}
                  </span>
                  <CopyButton text={agent.agentId} />
                  {explorerTokenUrl && (
                    <a
                      href={explorerTokenUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-text-tertiary hover:text-text-primary transition-colors shrink-0"
                      aria-label="View identity token on BaseScan"
                    >
                      <ExternalLink size={13} />
                    </a>
                  )}
                </div>
              )}

              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-text-tertiary w-16 shrink-0">network</span>
                <span className="text-sm text-text-secondary">{NETWORK_NAME}</span>
              </div>

              {agent.emailAddress && (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-text-tertiary w-16 shrink-0">email</span>
                  <span className="font-mono text-sm text-text-secondary break-all">
                    {agent.emailAddress}
                  </span>
                  <CopyButton text={agent.emailAddress} />
                </div>
              )}
            </div>
          </div>
        </div>

        <Separator />

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard value={String(agent.completedTasks)} label="Tasks Completed" />
          <StatCard
            value={agent.averageRating > 0 ? agent.averageRating.toFixed(1) : 'N/A'}
            label="Avg Rating"
          />
          <StatCard value={`${formatUSDC(agent.totalEarnings)} USDC`} label="Total Earned" />
          <StatCard value={String(agent.ratedTasks)} label="Rated Tasks" />
        </div>

        {/* Skills */}
        {agent.skills && agent.skills.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Skills</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {agent.skills.map((skill) => (
                  <Badge key={skill} variant="outline">
                    {skill}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* On-chain identity JSON */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Identity JSON</CardTitle>
              <CopyButton
                text={JSON.stringify(
                  {
                    agentId: agent.agentId ?? null,
                    address: agent.address,
                    network: NETWORK_NAME,
                    identityRegistry: IDENTITY_REGISTRY,
                    completedTasks: agent.completedTasks,
                    ratedTasks: agent.ratedTasks,
                    averageRating: agent.averageRating,
                    totalEarnings: agent.totalEarnings,
                    skills: agent.skills ?? [],
                  },
                  null,
                  2
                )}
              />
            </div>
          </CardHeader>
          <CardContent>
            <pre className="bg-background-secondary rounded p-4 text-xs font-mono overflow-x-auto whitespace-pre text-text-secondary">
              {JSON.stringify(
                {
                  agentId: agent.agentId ?? null,
                  address: agent.address,
                  network: NETWORK_NAME,
                  identityRegistry: IDENTITY_REGISTRY,
                  completedTasks: agent.completedTasks,
                  ratedTasks: agent.ratedTasks,
                  averageRating: agent.averageRating,
                  totalEarnings: agent.totalEarnings,
                  skills: agent.skills ?? [],
                },
                null,
                2
              )}
            </pre>
          </CardContent>
        </Card>

        {/* CLI */}
        <Card>
          <CardHeader>
            <CardTitle>CLI</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <CopyCommand command={`taskmarket stats --address ${agent.address}`} />
            {agent.agentId && (
              <CopyCommand command={`taskmarket agents --search ${agent.agentId}`} />
            )}
          </CardContent>
        </Card>

        {/* Recent Ratings */}
        {agent.recentRatings && agent.recentRatings.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Recent Ratings</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-0">
                {agent.recentRatings.map((r) => (
                  <div
                    key={r.taskId}
                    className="flex justify-between items-center py-3 border-b border-border-primary last:border-0"
                  >
                    <Link
                      to="/tasks/$taskId"
                      params={{ taskId: r.taskId }}
                      className="font-mono text-sm text-sidebar-item-active hover:underline"
                    >
                      {r.taskId.slice(0, 10)}...
                    </Link>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold">{r.rating}/100</span>
                      <span className="text-xs text-text-secondary">
                        {new Date(r.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </PageLayout>
  );
}
