import { IconCircleCheckFilled, IconClock, IconTrendingUp, IconUsers } from '@tabler/icons-react';

import { formatNumber, formatUsdcUnits } from '@/lib/format';

type SectionCardsProps = {
  agentCount?: number;
  openTaskCount: number;
  taskCount: number;
  totalRewards: string;
};

export function SectionCards({
  agentCount,
  openTaskCount,
  taskCount,
  totalRewards,
}: SectionCardsProps) {
  const [rewardsValue, rewardsUnit = 'USDC'] = formatUsdcUnits(totalRewards).split(' ');
  const items = [
    {
      icon: IconTrendingUp,
      title: 'Tasks created',
      value: formatNumber(taskCount),
    },
    {
      icon: IconClock,
      title: 'Open tasks',
      value: formatNumber(openTaskCount),
    },
    {
      icon: IconUsers,
      title: 'Registered agents',
      value: formatNumber(agentCount),
    },
    {
      icon: IconCircleCheckFilled,
      title: 'Rewards posted',
      unit: rewardsUnit,
      value: rewardsValue,
    },
  ];

  return (
    <section
      aria-label="Marketplace metrics"
      className="mx-4 overflow-hidden rounded-lg border border-border/58 bg-card/44 lg:mx-6"
    >
      <dl className="grid grid-cols-1 sm:grid-cols-2 @5xl/main:grid-cols-4">
        {items.map((item) => (
          <div
            className="@container/card grid grid-cols-[1fr_auto] gap-4 border-b border-border/58 px-5 py-5 last:border-b-0 sm:[&:nth-child(2n)]:border-l sm:[&:nth-child(2n)]:border-l-border/58 @5xl/main:border-b-0 @5xl/main:border-l @5xl/main:first:border-l-0"
            key={item.title}
          >
            <div className="min-w-0 space-y-3">
              <dt className="text-[0.8125rem] font-medium text-muted-foreground">{item.title}</dt>
              <dd className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 font-mono text-3xl font-semibold leading-none tracking-normal text-foreground tabular-nums @[250px]/card:text-[2rem]">
                <span>{item.value}</span>
                {item.unit ? (
                  <span className="font-sans text-sm font-semibold uppercase tracking-normal text-muted-foreground">
                    {item.unit}
                  </span>
                ) : null}
              </dd>
            </div>
            <div className="flex size-8 items-center justify-center rounded-md border border-border/58 bg-background/44 text-muted-foreground">
              <item.icon aria-hidden="true" className="size-4" />
            </div>
          </div>
        ))}
      </dl>
    </section>
  );
}
