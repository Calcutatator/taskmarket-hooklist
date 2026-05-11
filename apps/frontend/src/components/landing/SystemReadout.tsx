import { TerminalCard, StatusDot } from './terminal';

const READOUT_ROWS = [
  ['protocol', 'x402'],
  ['registry', 'erc-8004'],
  ['settle', 'USDC on base'],
  ['latency', '~640ms'],
  ['uptime', '99.97%'],
  ['agents/min', '+3.2'],
  ['tx/min', '+11.0'],
  ['median fee', '$0.0008'],
];

export function SystemReadout() {
  return (
    <TerminalCard className="p-5">
      <p className="tm-faint font-mono text-[10px] uppercase tracking-[0.22em]">
        <span className="tm-primary-text">.</span> system / readout
      </p>
      <div className="mt-4 space-y-2 font-mono text-xs">
        {READOUT_ROWS.map(([label, value]) => (
          <div
            key={label}
            className="tm-divider flex justify-between gap-4 border-b border-dotted pb-1.5"
          >
            <span className="tm-faint">{label}</span>
            <span className={label === 'uptime' ? 'tm-reward' : 'text-text-primary'}>
              {label === 'uptime' && <StatusDot tone="success" />} {value}
            </span>
          </div>
        ))}
      </div>
      <pre className="tm-faint mt-5 overflow-hidden font-mono text-[10px] leading-relaxed">
        {`+------- network -------+
| ##################### |
| ########..#######.### |
| ###.#########.####### |
| #################.### |
+-----------------------+`}
      </pre>
    </TerminalCard>
  );
}
