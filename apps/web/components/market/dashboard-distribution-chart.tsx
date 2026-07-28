'use client';

import type { BreakdownsResponse } from '@taskmarket/shared';
import { useMemo, useState } from 'react';

import {
  ChartCard,
  RangeToggle,
  StatusBreakdown,
  statusColor,
  type StatusDatum,
  type TaskStatusBucket,
} from '@/components/charts';
import { trpc } from '@/lib/api/client';
import { BUCKET_LABEL, BUCKET_ORDER, STATUS_BUCKET } from '@/lib/charts/inbox-aggregations';
import { formatNumber } from '@/lib/format';

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function modeLabel(value: string): string {
  return capitalize(value.replaceAll('_', ' '));
}

function percentOf(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function toStatusData(status: BreakdownsResponse['status']): StatusDatum[] {
  const totals = new Map<TaskStatusBucket, number>();
  for (const row of status) {
    const bucket = STATUS_BUCKET[row.status] ?? 'expired';
    totals.set(bucket, (totals.get(bucket) ?? 0) + row.count);
  }

  return BUCKET_ORDER.filter((bucket) => (totals.get(bucket) ?? 0) > 0).map((bucket) => ({
    bucket,
    label: BUCKET_LABEL[bucket],
    value: totals.get(bucket) ?? 0,
  }));
}

// The mode view reuses the donut shape but has no status semantics, so each mode
// borrows a status bucket purely as a distinct palette slot (by index). Only the
// label and value carry meaning here.
function toModeDonutData(mode: BreakdownsResponse['mode']): StatusDatum[] {
  return mode
    .filter((row) => row.count > 0)
    .map((row, index) => ({
      bucket: BUCKET_ORDER[index % BUCKET_ORDER.length],
      label: modeLabel(row.mode),
      value: row.count,
    }));
}

type BreakdownRow = {
  label: string;
  value: number;
  color: string;
  percent: number;
};

type SummaryStat = {
  label: string;
  value: string;
};

const VIEW_OPTIONS = [
  { value: 'status', label: 'By status', shortLabel: 'Status' },
  { value: 'mode', label: 'By mode', shortLabel: 'Mode' },
];

// The task distribution card. A status donut by default, switchable to the mode
// mix, paired with a ranked breakdown (exact counts the donut hides) and a
// derived summary strip so the card carries real detail and balances the live
// activity feed beside it. Seeds from the SSR breakdowns and refreshes every
// thirty seconds; empty arrays render the empty state.
export function DashboardDistributionChart({ initialData }: { initialData: BreakdownsResponse }) {
  const [view, setView] = useState<'status' | 'mode'>('status');

  const { data } = trpc.stats.breakdowns.useQuery(
    {},
    {
      initialData,
      refetchInterval: 30_000,
      refetchOnWindowFocus: true,
    }
  );

  const breakdowns = data ?? { actorType: [], mode: [], status: [] };

  // Donut data keeps the canonical bucket order; the list ranks by size.
  const donutData = useMemo<StatusDatum[]>(
    () => (view === 'status' ? toStatusData(breakdowns.status) : toModeDonutData(breakdowns.mode)),
    [view, breakdowns.status, breakdowns.mode]
  );

  const total = useMemo(() => donutData.reduce((sum, entry) => sum + entry.value, 0), [donutData]);

  const rows = useMemo<BreakdownRow[]>(
    () =>
      donutData
        .map((entry) => ({
          label: entry.label,
          value: entry.value,
          color: statusColor(entry.bucket),
          percent: percentOf(entry.value, total),
        }))
        .sort((a, b) => b.value - a.value),
    [donutData, total]
  );

  const summary = useMemo<SummaryStat[]>(() => {
    if (rows.length === 0) {
      return [];
    }
    if (view === 'status') {
      const byBucket = new Map(donutData.map((entry) => [entry.bucket, entry.value]));
      const open = byBucket.get('open') ?? 0;
      const inProgress = (byBucket.get('active') ?? 0) + (byBucket.get('pending') ?? 0);
      const completed = byBucket.get('completed') ?? 0;
      return [
        { label: 'Open', value: `${percentOf(open, total)}%` },
        { label: 'In progress', value: `${percentOf(inProgress, total)}%` },
        { label: 'Completed', value: `${percentOf(completed, total)}%` },
      ];
    }
    const top = rows[0];
    return [
      { label: 'Top mode', value: top.label },
      { label: 'Share', value: `${top.percent}%` },
      { label: 'Modes', value: formatNumber(rows.length) },
    ];
  }, [view, rows, donutData, total]);

  return (
    <ChartCard
      action={
        <RangeToggle
          onValueChange={(next) => setView(next as 'status' | 'mode')}
          options={VIEW_OPTIONS}
          value={view}
        />
      }
      className="@4xl/main:h-full"
      contentClassName="flex flex-1 flex-col"
      description={
        view === 'status' ? 'Live task status mix.' : 'Tasks grouped by market mechanic.'
      }
      isEmpty={rows.length === 0}
      title="Task distribution"
    >
      <div className="flex h-full flex-col gap-6">
        <div className="grid flex-1 items-center gap-4 sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)] sm:gap-6">
          <StatusBreakdown
            ariaLabel={view === 'status' ? 'Task status distribution' : 'Task mode distribution'}
            centerCaption="tasks"
            centerLabel={formatNumber(total)}
            data={donutData}
            height={176}
            hideLegend
            valueFormatter={(value) => formatNumber(value)}
          />
          <ul className="flex flex-col justify-center gap-3">
            {rows.map((row) => (
              <li className="grid gap-1.5" key={row.label}>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden
                      className="size-2.5 shrink-0 rounded-[3px]"
                      style={{ backgroundColor: row.color }}
                    />
                    <span className="truncate text-foreground">{row.label}</span>
                  </span>
                  <span className="shrink-0 font-mono text-sm tabular-nums text-foreground">
                    {formatNumber(row.value)}
                    <span className="ml-1.5 text-muted-foreground">{row.percent}%</span>
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface/60">
                  <div
                    className="h-full rounded-full"
                    style={{ backgroundColor: row.color, width: `${Math.max(row.percent, 2)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
        {summary.length > 0 ? (
          <dl className="grid grid-cols-3 gap-3 border-t border-border/58 pt-5">
            {summary.map((stat) => (
              <div className="grid gap-1" key={stat.label}>
                <dt className="font-mono text-[0.65rem] uppercase tracking-wide text-muted-foreground">
                  {stat.label}
                </dt>
                <dd className="truncate font-mono text-lg font-semibold tabular-nums text-foreground">
                  {stat.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </ChartCard>
  );
}
