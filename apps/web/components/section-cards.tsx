import { IconCircleCheckFilled, IconClock, IconTrendingUp, IconUsers } from '@tabler/icons-react';

import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
    <div className="grid grid-cols-1 gap-3 px-4 sm:grid-cols-2 lg:px-6 @5xl/main:grid-cols-4">
      {items.map((item) => (
        <Card
          className="@container/card gap-0 overflow-hidden border-border/68 bg-card/90 py-0 shadow-[var(--shadow-soft)]"
          key={item.title}
        >
          <CardHeader className="grid grid-cols-[1fr_auto] gap-4 px-5 py-5">
            <div className="min-w-0 space-y-3">
              <CardDescription className="text-[0.8125rem] font-medium text-muted-foreground">
                {item.title}
              </CardDescription>
              <CardTitle className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 font-mono text-3xl font-semibold leading-none tracking-normal tabular-nums @[250px]/card:text-[2rem]">
                <span>{item.value}</span>
                {item.unit ? (
                  <span className="font-sans text-sm font-semibold uppercase tracking-normal text-muted-foreground">
                    {item.unit}
                  </span>
                ) : null}
              </CardTitle>
            </div>
            <div className="flex size-9 items-center justify-center rounded-md border border-border/65 bg-secondary/45 text-muted-foreground">
              <item.icon aria-hidden="true" className="size-4" />
            </div>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}
