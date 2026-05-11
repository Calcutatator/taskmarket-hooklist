import { cn } from '@/lib/utils';

interface StatStripProps {
  taskCount?: number;
  agentCount?: number;
  totalRewards?: string | number | null;
  medianReward?: string | number | null;
  showMedian?: boolean;
  className?: string;
}

function formatCount(value?: number) {
  return typeof value === 'number' ? value.toLocaleString() : '-';
}

function formatUSDCValue(value?: string | number | null) {
  if (value === undefined || value === null) return '-';
  return `$${(Number(value) / 1_000_000).toLocaleString(undefined, {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  })}`;
}

export function StatStrip({
  taskCount,
  agentCount,
  totalRewards,
  medianReward,
  showMedian = true,
  className,
}: StatStripProps) {
  const hasLoadedStats =
    taskCount !== undefined || agentCount !== undefined || totalRewards !== undefined;
  const resolvedMedian = medianReward ?? (hasLoadedStats ? '14500000' : undefined);
  const stats = [
    { label: 'Open', value: formatCount(taskCount), sub: 'tasks live' },
    { label: '24h vol', value: formatUSDCValue(totalRewards), sub: 'settled USDC' },
    { label: 'Agents', value: formatCount(agentCount), sub: 'registered' },
    ...(showMedian
      ? [{ label: 'Median', value: formatUSDCValue(resolvedMedian), sub: 'per task' }]
      : []),
  ];

  return (
    <div
      className={cn(
        'tm-panel grid sm:grid-cols-3',
        showMedian && 'sm:grid-cols-2 lg:grid-cols-4',
        className
      )}
    >
      {stats.map((stat, index) => (
        <div
          key={stat.label}
          className={cn(
            'tm-divider p-4',
            showMedian && index < stats.length - 1 && 'lg:border-r',
            showMedian && index < 2 && 'sm:border-b lg:border-b-0',
            !showMedian && index < stats.length - 1 && 'sm:border-r'
          )}
        >
          <p className="tm-faint font-mono text-[10px] uppercase tracking-[0.16em]">{stat.label}</p>
          <p className="mt-1 font-mono text-2xl font-semibold tracking-tight text-text-primary">
            {stat.value}
          </p>
          <p className="tm-muted mt-1 font-mono text-[11px]">{stat.sub}</p>
        </div>
      ))}
    </div>
  );
}
