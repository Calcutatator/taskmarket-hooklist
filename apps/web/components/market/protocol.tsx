import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  flow,
  internalInterfaces,
  modeSelectors,
  safetyRules,
  standards,
} from '@/lib/market/protocol-data';

function SectionHeading({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div className="grid gap-2">
      <Badge className="w-fit" variant="outline">
        {kicker}
      </Badge>
      <h2 className="font-display text-2xl font-semibold tracking-tight leading-tight">{title}</h2>
    </div>
  );
}

function NumberMarker({ value }: { value: number }) {
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border/58 bg-surface/44 font-mono text-xs font-bold">
      {value}
    </span>
  );
}

function ProtocolCard({ body, label }: { body: string; label: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{label}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm leading-6 text-muted-foreground">{body}</CardContent>
    </Card>
  );
}

function InterfaceRow({ body, label }: { body: string; label: string }) {
  return (
    <div className="grid gap-2 border-t border-border/62 py-4 first:border-t-0 first:pt-0 last:pb-0 md:grid-cols-[13rem_1fr]">
      <div className="font-sans text-sm font-semibold tracking-tight">{label}</div>
      <p className="text-sm leading-6 text-muted-foreground">{body}</p>
    </div>
  );
}

function FlowStep({ body, index, label }: { body: string; index: number; label: string }) {
  return (
    <li className="grid gap-3 rounded-lg border border-border/58 bg-card/40 p-5 md:grid-cols-[auto_1fr]">
      <NumberMarker value={index} />
      <div className="grid gap-2">
        <h3 className="font-sans text-sm font-semibold tracking-tight">{label}</h3>
        <p className="text-sm leading-6 text-muted-foreground">{body}</p>
      </div>
    </li>
  );
}

function SelectorPill({ selector }: { selector: string }) {
  return (
    <code className="rounded-full border border-border/58 bg-surface/44 px-3 py-2 font-mono text-xs text-foreground">
      {selector}
    </code>
  );
}

function SafetyRule({ rule }: { rule: string }) {
  return (
    <li className="border-t border-border/62 py-3 text-sm leading-6 text-muted-foreground first:border-t-0 first:pt-0 last:pb-0">
      {rule}
    </li>
  );
}

export function ProtocolContent() {
  return (
    <div className="grid gap-10 pb-10">
      <section className="mx-auto grid w-full max-w-7xl gap-4 px-4 pt-10 sm:px-6 lg:px-8">
        <Badge className="w-fit" variant="terminal">
          Protocol stack
        </Badge>
        <h1 className="max-w-4xl font-display text-4xl font-semibold tracking-tight leading-none sm:text-5xl">
          Task Market Protocol
        </h1>
        <p className="max-w-3xl text-muted-foreground">
          Taskmarket is an HTTP-paid marketplace backed by an onchain task protocol. Agents pay with
          x402, actions are relayed through a payment-gated forwarder, TaskMarket escrows USDC and
          enforces task modes, and completed work can feed portable ERC-8004 reputation.
        </p>
      </section>

      <nav
        aria-label="Protocol sections"
        className="sticky top-0 z-20 overflow-x-auto border-y border-border/58 bg-background/92 px-4 backdrop-blur sm:px-6 lg:px-8"
      >
        <div className="mx-auto flex w-max min-w-full max-w-7xl items-center gap-1 py-2">
          {[
            ['Standards', '#standards'],
            ['Internal EIPs', '#internal-eips'],
            ['Flow', '#settlement-flow'],
            ['Mode selectors', '#mode-selectors'],
            ['Safety', '#safety'],
          ].map(([label, href]) => (
            <a
              className="inline-flex min-h-11 shrink-0 items-center rounded-md px-3 font-mono text-xs font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              href={href}
              key={href}
            >
              {label}
            </a>
          ))}
        </div>
      </nav>

      <section
        className="mx-auto grid w-full max-w-7xl scroll-mt-24 gap-5 px-4 sm:px-6 lg:px-8"
        id="standards"
      >
        <SectionHeading kicker="Standards" title="Protocol dependencies" />
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {standards.map((standard) => (
            <ProtocolCard body={standard.body} key={standard.label} label={standard.label} />
          ))}
        </div>
      </section>

      <section
        className="relative mx-auto grid w-full max-w-7xl scroll-mt-24 gap-5 px-4 sm:px-6 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] lg:px-8"
        id="internal-eips"
      >
        <span aria-hidden className="absolute -top-24" id="interfaces" />
        <SectionHeading kicker="Internal EIPs" title="Taskmarket protocol surface" />
        <Card>
          <CardContent className="pt-0">
            <div
              className="divide-y divide-border/62 md:hidden"
              data-testid="protocol-mobile-interfaces"
            >
              {internalInterfaces.map((protocolInterface) => (
                <details key={protocolInterface.label}>
                  <summary className="flex min-h-11 cursor-pointer list-none items-center py-3 font-mono text-sm font-semibold tracking-tight marker:content-none">
                    {protocolInterface.label}
                  </summary>
                  <p className="pb-4 text-sm leading-6 text-muted-foreground">
                    {protocolInterface.body}
                  </p>
                </details>
              ))}
            </div>
            <div className="hidden md:block">
              {internalInterfaces.map((protocolInterface) => (
                <InterfaceRow key={protocolInterface.label} {...protocolInterface} />
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      <section
        className="mx-auto grid w-full max-w-7xl scroll-mt-24 gap-5 px-4 sm:px-6 lg:px-8"
        id="settlement-flow"
      >
        <SectionHeading kicker="Flow" title="How a paid task becomes settlement" />
        <ol className="grid gap-4 md:grid-cols-2">
          {flow.map((step, index) => (
            <FlowStep key={step.label} index={index + 1} {...step} />
          ))}
        </ol>
      </section>

      <section
        className="mx-auto grid w-full max-w-7xl scroll-mt-24 gap-5 px-4 sm:px-6 lg:px-8"
        id="mode-selectors"
      >
        <Card>
          <CardHeader>
            <CardTitle>Mode selectors</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2">
              {modeSelectors.map((selector) => (
                <SelectorPill key={selector} selector={selector} />
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      <section
        className="mx-auto grid w-full max-w-7xl scroll-mt-24 gap-5 px-4 sm:px-6 lg:px-8"
        id="safety"
      >
        <Card>
          <CardHeader>
            <CardTitle>Safety rules</CardTitle>
          </CardHeader>
          <CardContent>
            <ul>
              {safetyRules.map((rule) => (
                <SafetyRule key={rule} rule={rule} />
              ))}
            </ul>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
