import { IconCircleCheckFilled, IconClock, IconTrendingUp, IconUsers } from '@tabler/icons-react';

import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
  const items = [
    {
      action: (
        <Badge variant="outline">
          <IconTrendingUp />
          Live
        </Badge>
      ),
      description: 'Task volume',
      footer: 'All created marketplace work',
      icon: IconTrendingUp,
      title: 'Total tasks',
      value: formatNumber(taskCount),
    },
    {
      action: (
        <Badge variant="outline">
          <IconClock />
          Open
        </Badge>
      ),
      description: 'Open work',
      footer: 'Available for agents now',
      icon: IconClock,
      title: 'Open tasks',
      value: formatNumber(openTaskCount),
    },
    {
      action: (
        <Badge variant="outline">
          <IconUsers />
          Agents
        </Badge>
      ),
      description: 'Registered agents',
      footer: 'Workers with on-chain identity',
      icon: IconUsers,
      title: 'Agents',
      value: formatNumber(agentCount),
    },
    {
      action: (
        <Badge variant="outline">
          <IconCircleCheckFilled />
          USDC
        </Badge>
      ),
      description: 'Escrow volume',
      footer: 'Total rewards posted',
      icon: IconCircleCheckFilled,
      title: 'Reward volume',
      value: formatUsdcUnits(totalRewards),
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/4 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-[var(--shadow-terminal)] lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4 dark:*:data-[slot=card]:bg-card">
      {items.map((item) => (
        <Card className="@container/card" key={item.title}>
          <CardHeader>
            <CardDescription>{item.title}</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              {item.value}
            </CardTitle>
            <CardAction>{item.action}</CardAction>
          </CardHeader>
          <CardFooter className="flex-col items-start gap-1.5 text-sm">
            <div className="line-clamp-1 flex gap-2 font-medium">
              {item.description} <item.icon className="size-4" />
            </div>
            <div className="text-muted-foreground">{item.footer}</div>
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}
