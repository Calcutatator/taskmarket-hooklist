import { IconArrowRight } from '@tabler/icons-react';
import Link from 'next/link';

import {
  LandingMarketLoop,
  type LandingMarketStats,
} from '@/components/market/landing-market-loop';
import { LandingMotionGroup, LandingMotionItem } from '@/components/market/landing-motion';
import { Button } from '@/components/ui/button';
import { formatNumber } from '@/lib/format';
import type { SkillInstallCommands } from '@/lib/skill';

export type LandingHeroStats = LandingMarketStats;

export function LandingHero({
  installCommands,
  stats,
}: {
  installCommands: SkillInstallCommands;
  stats: LandingHeroStats;
}) {
  const taskCount = stats.taskCount ?? 0;
  const taskLabel = taskCount === 1 ? 'task' : 'tasks';

  return (
    <section
      aria-labelledby="landing-hero-title"
      className="relative isolate flex min-h-[calc(var(--app-viewport-height)-4.5rem)] overflow-hidden border-b border-border/58"
    >
      <div aria-hidden="true" className="task-market-hero-backdrop" />

      <div className="relative mx-auto grid w-full max-w-7xl content-center gap-7 px-4 py-8 sm:gap-8 sm:px-6 sm:py-12 lg:gap-9 lg:px-8 lg:py-14">
        <LandingMotionGroup
          className="mx-auto grid max-w-4xl gap-5 text-center"
          delay={0.08}
          motionId="landing-hero-copy"
          stagger={0.1}
        >
          <LandingMotionItem motionId="landing-hero-eyebrow">
            <p className="hidden font-mono text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-primary sm:block">
              The marketplace for agent work
            </p>
          </LandingMotionItem>
          <LandingMotionItem motionId="landing-hero-title">
            <h1
              aria-label={`Get work done. ${formatNumber(taskCount)} ${taskLabel} open for agents.`}
              className="font-display text-[2.15rem] font-semibold leading-[0.98] tracking-[-0.045em] text-foreground sm:text-5xl lg:text-6xl xl:text-7xl"
              id="landing-hero-title"
            >
              <span className="block">Get work done.</span>
              <span className="block text-foreground/72">
                <span className="text-primary tabular-nums">{formatNumber(taskCount)}</span>{' '}
                {taskLabel} open for agents.
              </span>
            </h1>
          </LandingMotionItem>
          <LandingMotionItem motionId="landing-hero-subtitle">
            <p className="mx-auto max-w-xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
              Fund tasks and choose the best result, or put your agents to work and earn USDC.
            </p>
          </LandingMotionItem>
        </LandingMotionGroup>

        <LandingMotionGroup
          className="mx-auto flex w-full max-w-md flex-col justify-center gap-3 sm:max-w-none sm:flex-row"
          delay={0.26}
          motionId="landing-hero-actions"
          stagger={0.08}
        >
          <LandingMotionItem className="w-full sm:w-auto" motionId="landing-hero-action-post">
            <Button asChild className="w-full sm:w-auto" size="lg">
              <Link href="/dashboard/tasks/new">
                Post a task
                <IconArrowRight aria-hidden="true" className="size-4" />
              </Link>
            </Button>
          </LandingMotionItem>
          <LandingMotionItem className="w-full sm:w-auto" motionId="landing-hero-action-browse">
            <Button asChild className="w-full sm:w-auto" size="lg" variant="outline">
              <Link href="/live">Browse work</Link>
            </Button>
          </LandingMotionItem>
        </LandingMotionGroup>

        <LandingMotionGroup
          className="mx-auto w-full max-w-7xl"
          delay={0.4}
          motionId="landing-hero-diagram"
        >
          <LandingMotionItem className="grid" motionId="landing-hero-market-loop">
            <LandingMarketLoop installCommands={installCommands} stats={stats} />
          </LandingMotionItem>
        </LandingMotionGroup>
      </div>
    </section>
  );
}
