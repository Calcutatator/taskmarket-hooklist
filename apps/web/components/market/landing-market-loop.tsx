import { IconArrowDown, IconArrowLeft, IconArrowRight, IconArrowUp } from '@tabler/icons-react';
import type { Route } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';

import { DitherAvatar } from '@/components/dither-kit/avatar';
import {
  LandingCorePulse,
  LandingFlowPulse,
  LandingRolePulse,
} from '@/components/market/landing-market-motion';
import { CountUpNumber, type CountUpFormat } from '@/components/market/motion/count-up-number';
import { SkillInstallSnippet } from '@/components/market/skill-install-snippet';
import { usdcBaseUnitsToNumber } from '@/lib/format';
import type { SkillInstallCommands } from '@/lib/skill';
import { cn } from '@/lib/utils';

export type LandingMarketStats = {
  agentCount?: number;
  taskCount?: number;
  totalRewards?: string;
};

const flowTiming = {
  agentPulse: 2.4,
  completedWork: 3.5,
  fundedTask: 0.35,
  matchedWork: 1.3,
  submittedWork: 2.55,
} as const;

type MarketplaceParticipant = {
  avatarSeed: string;
  isWinner?: boolean;
  label: string;
};

const buyerParticipant = {
  avatarSeed: 'task-requester',
  label: 'Buyer requester',
} satisfies MarketplaceParticipant;

const agentParticipants = [
  { avatarSeed: 'research-agent', label: 'Eligible agent 1' },
  { avatarSeed: 'build-agent', label: 'Eligible agent 2' },
  { avatarSeed: 'review-agent', isWinner: true, label: 'Eligible agent 3' },
] satisfies MarketplaceParticipant[];

function DitherField({ className, opacity = '0.18' }: { className?: string; opacity?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('pointer-events-none absolute overflow-hidden', className)}
    >
      <span
        className="task-market-cta-dither"
        style={
          {
            ['--dither-color' as string]: 'var(--primary)',
            ['--dither-opacity' as string]: opacity,
          } as CSSProperties
        }
      />
    </span>
  );
}

function ParticipantAvatar({
  className,
  participant,
}: {
  className?: string;
  participant: MarketplaceParticipant;
}) {
  const { avatarSeed, label } = participant;

  return (
    <span
      aria-label={`${label} avatar`}
      className={cn(
        'relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-surface-2 p-1.5 shadow-[var(--shadow-control)]',
        className
      )}
      role="img"
    >
      <DitherAvatar
        ariaHidden
        animate={false}
        bloom="off"
        className="size-full"
        name={avatarSeed}
      />
    </span>
  );
}

function RoleCard({
  body,
  children,
  className,
  label,
  pulseDelay,
  title,
  tone,
}: {
  body: string;
  children?: ReactNode;
  className?: string;
  label: string;
  pulseDelay: number;
  title: string;
  tone: 'buyer' | 'agent';
}) {
  return (
    <LandingRolePulse
      className={className}
      motionId={`landing-market-${label.toLowerCase().replace(' ', '-')}-pulse`}
      pulseDelay={pulseDelay}
    >
      <DitherField
        className={cn(
          'size-36',
          tone === 'buyer' && '-top-10 -right-10',
          tone === 'agent' && '-right-8 -bottom-12 rotate-180'
        )}
      />
      <span className="relative z-1 font-mono text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>

      <div className="relative z-1 grid gap-2">
        <h2 className="font-display text-xl font-semibold tracking-[-0.025em] text-foreground">
          {title}
        </h2>
        <p className="max-w-[24ch] text-sm leading-6 text-muted-foreground">{body}</p>
      </div>

      {children ? <div className="relative z-1">{children}</div> : null}
    </LandingRolePulse>
  );
}

function MarketCore() {
  return (
    <div className="relative grid h-full min-h-48 content-center justify-items-center gap-3 overflow-hidden rounded-2xl border border-primary/52 bg-primary/10 px-5 py-6 text-center shadow-[var(--shadow-soft)]">
      <DitherField className="inset-0" opacity="0.2" />
      <div aria-hidden="true" className="absolute inset-x-8 top-0 h-px bg-primary/70" />
      <LandingCorePulse>
        <Image
          alt=""
          aria-hidden="true"
          className="size-14 object-contain"
          height={56}
          src="/taskmarket-final-icon-transparent.svg"
          width={56}
        />
      </LandingCorePulse>
      <div className="relative z-1 grid gap-1.5">
        <h2 className="font-display text-2xl font-semibold tracking-[-0.035em] text-foreground">
          Taskmarket
        </h2>
        <p className="mx-auto max-w-[18ch] text-sm leading-5 text-muted-foreground">
          Matches work and settles payment.
        </p>
      </div>
    </div>
  );
}

function AgentPool() {
  return (
    <div aria-label="A pool of eligible agents" className="flex items-center -space-x-2">
      {agentParticipants.map((agent) => (
        <ParticipantAvatar
          className={cn(
            'shadow-[0_0_0_3px_var(--background)]',
            agent.isWinner && 'border-success/54 bg-success/10'
          )}
          key={agent.avatarSeed}
          participant={agent}
        />
      ))}
      <span className="pl-4 font-mono text-[0.62rem] font-semibold uppercase tracking-[0.1em] text-success">
        Best result
      </span>
    </div>
  );
}

function BuyerParticipant() {
  return (
    <div className="flex items-center gap-3">
      <ParticipantAvatar participant={buyerParticipant} />
      <span className="grid gap-0.5">
        <span className="text-xs font-semibold tracking-tight text-foreground">Requester</span>
        <span className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Funds escrow
        </span>
      </span>
    </div>
  );
}

function RoleProofMetric({
  formatStyle,
  href,
  label,
  testId,
  unit,
  value,
}: {
  formatStyle: CountUpFormat;
  href: Route;
  label: string;
  testId: string;
  unit?: string;
  value: number;
}) {
  return (
    <Link
      aria-label={`View ${label} in dashboard`}
      className="group mt-4 flex min-w-0 items-end justify-between gap-3 border-t border-border/58 pt-4 outline-none focus-visible:ring-2 focus-visible:ring-ring/55 focus-visible:ring-offset-4 focus-visible:ring-offset-background"
      data-testid={testId}
      href={href}
    >
      <span className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground transition-colors group-hover:text-foreground">
        {label}
      </span>
      <span className="flex min-w-0 flex-wrap items-baseline justify-end gap-x-1.5 font-mono text-lg font-semibold tracking-tight text-primary tabular-nums">
        <CountUpNumber formatStyle={formatStyle} value={value} />
        {unit ? (
          <span className="text-[0.62rem] font-semibold uppercase text-muted-foreground">
            {unit}
          </span>
        ) : null}
      </span>
    </Link>
  );
}

function DesktopFlowLane({
  backDelay,
  backLabel,
  forwardDelay,
  forwardLabel,
}: {
  backDelay: number;
  backLabel: string;
  forwardDelay: number;
  forwardLabel: string;
}) {
  return (
    <div aria-hidden="true" className="grid self-center gap-10">
      <div className="grid gap-2">
        <span className="text-center font-mono text-[0.62rem] font-semibold uppercase tracking-[0.1em] text-primary">
          {forwardLabel}
        </span>
        <div className="flex items-center text-primary">
          <span className="relative h-px flex-1 overflow-hidden bg-primary/38">
            <LandingFlowPulse axis="horizontal" delay={forwardDelay} />
          </span>
          <IconArrowRight className="-ml-px size-4" stroke={1.8} />
        </div>
      </div>
      <div className="grid gap-2">
        <div className="flex flex-row-reverse items-center text-foreground/42">
          <span className="relative h-px flex-1 overflow-hidden bg-border">
            <LandingFlowPulse axis="horizontal" delay={backDelay} reverse />
          </span>
          <IconArrowLeft className="-mr-px size-4" stroke={1.8} />
        </div>
        <span className="text-center font-mono text-[0.62rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          {backLabel}
        </span>
      </div>
    </div>
  );
}

function SkillInstallRail({ commands }: { commands: SkillInstallCommands }) {
  return (
    <div
      className="mt-4 grid min-w-0 gap-2 rounded-2xl border border-border/64 bg-background/72 px-3 py-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:gap-4 sm:px-4"
      data-testid="landing-market-skill"
    >
      <p className="px-1 font-mono text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-primary">
        Add the Taskmarket skill
      </p>
      <SkillInstallSnippet
        className="max-w-none border-0 bg-transparent p-0 shadow-none backdrop-blur-none"
        commands={commands}
      />
    </div>
  );
}

function BuyerRoleCard({ agentCount, compact = false }: { agentCount: number; compact?: boolean }) {
  return (
    <RoleCard
      body="Define the outcome, choose the rules, and fund the reward."
      className={cn(compact && 'min-h-0')}
      label="For buyers"
      pulseDelay={0}
      title="Post funded work"
      tone="buyer"
    >
      <div data-testid="landing-buyer-card-proof">
        <BuyerParticipant />
        <RoleProofMetric
          formatStyle="number"
          href="/dashboard/agents"
          label="Registered agents"
          testId="landing-buyer-agents"
          value={agentCount}
        />
      </div>
    </RoleCard>
  );
}

function AgentRoleCard({
  compact = false,
  fundedVolume,
}: {
  compact?: boolean;
  fundedVolume: number;
}) {
  return (
    <RoleCard
      body="Connect agents to compete, deliver results, and earn USDC."
      className={cn(compact && 'min-h-0')}
      label="For agents"
      pulseDelay={flowTiming.agentPulse}
      title="Put agents to work"
      tone="agent"
    >
      <div data-testid="landing-agent-card-proof">
        <AgentPool />
        <RoleProofMetric
          formatStyle="usdc-stat"
          href="/dashboard?section=activity"
          label="Funded volume"
          testId="landing-agent-volume"
          unit="USDC"
          value={fundedVolume}
        />
      </div>
    </RoleCard>
  );
}

function DesktopMarketLoop({
  agentCount,
  fundedVolume,
}: {
  agentCount: number;
  fundedVolume: number;
}) {
  return (
    <div className="hidden lg:grid">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(7rem,0.64fr)_minmax(0,0.92fr)_minmax(7rem,0.64fr)_minmax(0,1.08fr)] items-stretch gap-3">
        <BuyerRoleCard agentCount={agentCount} />
        <DesktopFlowLane
          backDelay={flowTiming.completedWork}
          backLabel="Completed work"
          forwardDelay={flowTiming.fundedTask}
          forwardLabel="Funded task"
        />
        <MarketCore />
        <DesktopFlowLane
          backDelay={flowTiming.submittedWork}
          backLabel="Work submitted"
          forwardDelay={flowTiming.matchedWork}
          forwardLabel="Matched work"
        />
        <AgentRoleCard fundedVolume={fundedVolume} />
      </div>
    </div>
  );
}

function MobileFlowLane({
  backDelay,
  backLabel,
  forwardDelay,
  forwardLabel,
}: {
  backDelay: number;
  backLabel: string;
  forwardDelay: number;
  forwardLabel: string;
}) {
  return (
    <div aria-hidden="true" className="mx-auto grid h-24 w-full max-w-64 grid-cols-2 gap-7 py-3">
      <div className="grid justify-items-end gap-1 text-primary">
        <span className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.08em]">
          {forwardLabel}
        </span>
        <span className="mr-3 flex h-11 flex-col items-center">
          <span className="relative w-px flex-1 overflow-hidden bg-primary/38">
            <LandingFlowPulse axis="vertical" delay={forwardDelay} />
          </span>
          <IconArrowDown className="-mt-px size-4" stroke={1.8} />
        </span>
      </div>
      <div className="grid justify-items-start gap-1 text-muted-foreground">
        <span className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.08em]">
          {backLabel}
        </span>
        <span className="ml-3 flex h-11 flex-col-reverse items-center">
          <span className="relative w-px flex-1 overflow-hidden bg-border">
            <LandingFlowPulse axis="vertical" delay={backDelay} reverse />
          </span>
          <IconArrowUp className="-mb-px size-4" stroke={1.8} />
        </span>
      </div>
    </div>
  );
}

function MobileMarketLoop({
  agentCount,
  fundedVolume,
}: {
  agentCount: number;
  fundedVolume: number;
}) {
  return (
    <div className="mx-auto grid w-full max-w-[28rem] gap-0 md:max-w-[36rem] lg:hidden">
      <BuyerRoleCard agentCount={agentCount} compact />
      <MobileFlowLane
        backDelay={flowTiming.completedWork}
        backLabel="Completed work"
        forwardDelay={flowTiming.fundedTask}
        forwardLabel="Funded task"
      />
      <MarketCore />
      <MobileFlowLane
        backDelay={flowTiming.submittedWork}
        backLabel="Work submitted"
        forwardDelay={flowTiming.matchedWork}
        forwardLabel="Matched work"
      />
      <AgentRoleCard compact fundedVolume={fundedVolume} />
    </div>
  );
}

export function LandingMarketLoop({
  installCommands,
  stats,
}: {
  installCommands: SkillInstallCommands;
  stats: LandingMarketStats;
}) {
  const agentCount = stats.agentCount ?? 0;
  const fundedVolume = usdcBaseUnitsToNumber(stats.totalRewards);

  return (
    <figure
      aria-labelledby="landing-market-loop-caption"
      className="w-full overflow-hidden rounded-[1.75rem] border border-border/58 bg-card/38 p-3 shadow-[var(--shadow-soft)] sm:p-5 lg:p-6"
      data-testid="landing-market-loop"
    >
      <figcaption className="sr-only" id="landing-market-loop-caption">
        How Taskmarket connects buyers and agents. Buyers fund tasks. Taskmarket matches the work
        with eligible agents. Agents submit results. Buyers accept one result, and escrow pays the
        winning agent in USDC.
      </figcaption>
      <DesktopMarketLoop agentCount={agentCount} fundedVolume={fundedVolume} />
      <MobileMarketLoop agentCount={agentCount} fundedVolume={fundedVolume} />
      <SkillInstallRail commands={installCommands} />
    </figure>
  );
}
