// storybook-coverage: components/dither-kit/chart-context.tsx
// storybook-coverage: components/dither-kit/common-context.tsx
// storybook-coverage: components/charts/accessible-chart-table.tsx
// storybook-coverage: components/charts/bar-chart.tsx
// storybook-coverage: components/charts/chart-card.tsx
// storybook-coverage: components/charts/heatmap-grid.tsx
// storybook-coverage: components/charts/metric-stat.tsx
// storybook-coverage: components/charts/range-toggle.tsx
// storybook-coverage: components/charts/sparkline.tsx
// storybook-coverage: components/charts/status-breakdown.tsx
// storybook-coverage: components/charts/trend-area-chart.tsx
// storybook-coverage: components/charts/value-radial.tsx
// storybook-coverage: components/dither-kit/area-chart.tsx
// storybook-coverage: components/dither-kit/area.tsx
// storybook-coverage: components/dither-kit/avatar.tsx
// storybook-coverage: components/dither-kit/bar-canvas.tsx
// storybook-coverage: components/dither-kit/bar-chart.tsx
// storybook-coverage: components/dither-kit/bar.tsx
// storybook-coverage: components/dither-kit/block-legend.tsx
// storybook-coverage: components/dither-kit/cartesian-canvas.tsx
// storybook-coverage: components/dither-kit/cartesian-root.tsx
// storybook-coverage: components/dither-kit/dot.tsx
// storybook-coverage: components/dither-kit/grid.tsx
// storybook-coverage: components/dither-kit/pie-canvas.tsx
// storybook-coverage: components/dither-kit/pie-chart.tsx
// storybook-coverage: components/dither-kit/pie.tsx
// storybook-coverage: components/dither-kit/polar-context.tsx
// storybook-coverage: components/dither-kit/polar-root.tsx
// storybook-coverage: components/dither-kit/reference-line.tsx
// storybook-coverage: components/dither-kit/series-context.tsx
// storybook-coverage: components/dither-kit/tooltip.tsx
// storybook-coverage: components/dither-kit/x-axis.tsx
// storybook-coverage: components/dither-kit/y-axis.tsx

import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Activity, CircleDollarSign, Users } from 'lucide-react';
import { useState } from 'react';

import { HistogramBars } from '@/components/charts/bar-chart';
import { ChartCard } from '@/components/charts/chart-card';
import { HeatmapGrid } from '@/components/charts/heatmap-grid';
import { MetricStat } from '@/components/charts/metric-stat';
import { RangeToggle } from '@/components/charts/range-toggle';
import { Sparkline } from '@/components/charts/sparkline';
import { StatusBreakdown } from '@/components/charts/status-breakdown';
import { TrendAreaChart } from '@/components/charts/trend-area-chart';
import { ValueRadial } from '@/components/charts/value-radial';
import { DitherAvatar } from '@/components/dither-kit/avatar';
import { Button } from '@/components/ui/button';

function VisualizationCatalog() {
  return <div>Taskmarket visualizations</div>;
}

const meta = {
  component: VisualizationCatalog,
  parameters: {
    docs: {
      description: {
        component:
          'Accessible, theme-aware data visualization components. Every chart includes an accessible table or equivalent textual representation.',
      },
    },
  },
  title: 'Visualizations/Catalog',
} satisfies Meta<typeof VisualizationCatalog>;

export default meta;
type Story = StoryObj<typeof meta>;

const trendData = [
  { date: '2026-07-27', created: 12, completed: 5, disputed: 1 },
  { date: '2026-07-28', created: 18, completed: 9, disputed: 2 },
  { date: '2026-07-29', created: 14, completed: 12, disputed: 0 },
  { date: '2026-07-30', created: 24, completed: 15, disputed: 1 },
  { date: '2026-07-31', created: 21, completed: 18, disputed: 3 },
  { date: '2026-08-01', created: 30, completed: 22, disputed: 1 },
  { date: '2026-08-02', created: 34, completed: 27, disputed: 0 },
];

function StatefulRange() {
  const [value, setValue] = useState('30d');
  return <RangeToggle ariaLabel="Chart range" onValueChange={setValue} value={value} />;
}

export const MetricVariants: Story = {
  render: () => (
    <dl className="grid max-w-6xl gap-6 rounded-lg border border-border/58 bg-card/44 p-6 md:grid-cols-3">
      <MetricStat
        delta={{ value: 18, direction: 'up' }}
        icon={Activity}
        label="Active tasks"
        sparkline={[11, 14, 13, 18, 22, 21, 29]}
        value={148}
      />
      <MetricStat
        delta={{ value: -3.2, direction: 'down' }}
        icon={Users}
        label="Online agents"
        sparkline={[94, 92, 96, 91, 88, 86, 84]}
        value={84}
      />
      <MetricStat
        animateValue={false}
        icon={CircleDollarSign}
        label="Settled volume"
        unit="USDC"
        value="1,284,220"
      />
    </dl>
  ),
};

export const ChartCardStates: Story = {
  render: () => (
    <div className="grid max-w-7xl gap-5 md:grid-cols-2">
      <ChartCard action={<StatefulRange />} description="A populated chart" title="Activity trend">
        <TrendAreaChart
          ariaLabel="Task activity trend"
          data={trendData}
          height={220}
          referenceLabel="Target"
          referenceY={20}
          series={[
            { key: 'created', label: 'Created' },
            { key: 'completed', label: 'Completed' },
          ]}
          xKey="date"
        />
      </ChartCard>
      <ChartCard
        isLoading
        action={<StatefulRange />}
        description="Loading data"
        title="Activity trend"
      >
        <div />
      </ChartCard>
      <ChartCard
        emptyAction={<Button variant="outline">Create first task</Button>}
        emptyDescription="Once the first task is published, its activity will appear here."
        emptyTitle="No task activity"
        isEmpty
        title="Activity trend"
      >
        <div />
      </ChartCard>
      <ChartCard errorMessage="The activity service could not be reached." title="Activity trend">
        <div />
      </ChartCard>
    </div>
  ),
};

export const TrendCharts: Story = {
  render: () => (
    <div className="grid max-w-6xl gap-8">
      <TrendAreaChart
        ariaLabel="Created completed and disputed tasks"
        data={trendData}
        referenceLabel="Daily target"
        referenceY={20}
        series={[
          { key: 'created', label: 'Created' },
          { key: 'completed', label: 'Completed' },
          { key: 'disputed', label: 'Disputed' },
        ]}
        xKey="date"
      />
      <TrendAreaChart
        ariaLabel="Stacked task outcomes"
        data={trendData}
        series={[
          { key: 'completed', label: 'Completed' },
          { key: 'disputed', label: 'Disputed' },
        ]}
        stacked
        xKey="date"
      />
    </div>
  ),
};

export const Histograms: Story = {
  render: () => (
    <div className="grid max-w-5xl gap-8 md:grid-cols-2">
      <HistogramBars
        ariaLabel="Agent rating distribution"
        data={[
          { label: '1 star', value: 2 },
          { label: '2 stars', value: 4 },
          { label: '3 stars', value: 12 },
          { label: '4 stars', value: 29 },
          { label: '5 stars', value: 51 },
        ]}
      />
      <HistogramBars
        ariaLabel="Empty rating distribution"
        data={[
          { label: '1 star', value: 0 },
          { label: '2 stars', value: 0 },
          { label: '3 stars', value: 0 },
          { label: '4 stars', value: 0 },
          { label: '5 stars', value: 0 },
        ]}
      />
    </div>
  ),
};

export const StatusDonuts: Story = {
  render: () => (
    <div className="grid max-w-5xl gap-8 md:grid-cols-3">
      <StatusBreakdown
        ariaLabel="All task statuses"
        centerCaption="tasks"
        centerLabel="148"
        data={[
          { bucket: 'open', label: 'Open', value: 42 },
          { bucket: 'active', label: 'Active', value: 38 },
          { bucket: 'pending', label: 'Pending', value: 15 },
          { bucket: 'completed', label: 'Completed', value: 46 },
          { bucket: 'disputed', label: 'Disputed', value: 4 },
          { bucket: 'expired', label: 'Expired', value: 3 },
        ]}
      />
      <StatusBreakdown
        ariaLabel="Single task status"
        centerCaption="tasks"
        centerLabel="42"
        data={[{ bucket: 'open', label: 'Open', value: 42 }]}
      />
      <StatusBreakdown
        ariaLabel="No task statuses"
        centerCaption="tasks"
        centerLabel="0"
        data={[]}
      />
    </div>
  ),
};

export const RadialBoundaries: Story = {
  render: () => (
    <div className="grid max-w-5xl gap-8 md:grid-cols-4">
      <ValueRadial caption="unused" max={100} name="Budget used" value={0} />
      <ValueRadial caption="used" max={100} name="Budget used" value={42} />
      <ValueRadial caption="complete" max={100} name="Budget used" value={100} />
      <ValueRadial caption="clamped" max={100} name="Budget used" value={140} />
    </div>
  ),
};

export const HeatmapStates: Story = {
  render: () => (
    <div className="grid max-w-6xl gap-8">
      <HeatmapGrid
        colLabel="Day"
        data={{
          cells: [
            { col: 'Mon', count: 2, row: 'Bounty', volume: '50000000' },
            { col: 'Tue', count: 8, row: 'Bounty', volume: '225000000' },
            { col: 'Wed', count: 4, row: 'Auction', volume: '80000000' },
            { col: 'Thu', count: 12, row: 'Competition', volume: '560000000' },
            { col: 'Fri', count: 6, row: 'Bounty', volume: '175000000' },
          ],
          colKeys: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
          maxCount: 12,
          rowKeys: ['Bounty', 'Auction', 'Competition'],
        }}
        rowLabel="Mode"
        title="Marketplace activity"
      />
      <HeatmapGrid
        data={{ cells: [], colKeys: ['Mon', 'Tue'], maxCount: 0, rowKeys: ['Bounty'] }}
        title="Empty activity"
      />
    </div>
  ),
};

export const Sparklines: Story = {
  render: () => (
    <div className="flex flex-wrap gap-8 rounded-lg border border-border/58 bg-card/44 p-6">
      <Sparkline data={[3, 7, 5, 11, 9, 14, 18]} />
      <Sparkline data={[18, 14, 15, 9, 11, 7, 3]} type="line" />
      <Sparkline data={[5]} />
      <Sparkline data={[]} />
    </div>
  ),
};

export const GeneratedAvatars: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-6">
      <DitherAvatar animate={false} name="Atlas evaluator" size={48} />
      <DitherAvatar
        animate={false}
        bloom="low"
        mirror="horizontal"
        name="Boreal worker"
        size={64}
      />
      <DitherAvatar
        animate={false}
        bloom="high"
        mirror="vertical"
        name="Cinder requester"
        size={80}
      />
      <DitherAvatar animate={false} color="var(--chart-4)" name="Delta agent" size={96} />
    </div>
  ),
};
