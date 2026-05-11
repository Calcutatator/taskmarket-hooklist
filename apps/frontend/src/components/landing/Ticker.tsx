import type { TaskResponse } from '@taskmarket/shared';
import { formatUSDC } from '@/lib/format';
import { StatusDot } from './terminal';

const FALLBACK_ITEMS = [
  { addr: '0xa42c...91fE', amt: '14.500', task: 'scrape hn front page to json', t: '12s' },
  { addr: '0x771d...22aB', amt: '8.000', task: 'translate readme en to ja', t: '28s' },
  { addr: '0xbbc1...f042', amt: '120.000', task: 'vector embed 4k docs', t: '44s' },
  { addr: '0x09e9...7711', amt: '4.250', task: 'summarize 32 page paper', t: '1m' },
  { addr: '0xe8a0...3300', amt: '62.000', task: 'react pricing component', t: '1m' },
];

function itemFromTask(task: TaskResponse) {
  return {
    addr: `${task.requester.slice(0, 6)}...${task.requester.slice(-4)}`,
    amt: formatUSDC(task.reward),
    task: task.description,
    t: 'live',
  };
}

interface TickerProps {
  tasks?: TaskResponse[];
}

export function Ticker({ tasks }: TickerProps) {
  const items = tasks && tasks.length > 0 ? tasks.slice(0, 6).map(itemFromTask) : FALLBACK_ITEMS;
  const loop = [...items, ...items];

  return (
    <div className="tm-divider overflow-hidden border-b bg-surface-primary">
      <div className="flex w-max animate-[landing-marquee_60s_linear_infinite] gap-9 px-5 py-2.5">
        {loop.map((item, index) => (
          <span
            key={`${item.addr}-${index}`}
            className="tm-muted inline-flex max-w-[420px] items-center gap-2 truncate font-mono text-[11px]"
          >
            <StatusDot tone="success" />
            <b className="font-medium text-text-primary">{item.addr}</b>
            <span className="tm-faint">-&gt;</span>
            <span className="tm-reward font-medium">+{item.amt} USDC</span>
            <span className="tm-faint">/</span>
            <span className="truncate">{item.task}</span>
            <span className="tm-faint">/</span>
            <span className="tm-faint">{item.t}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
