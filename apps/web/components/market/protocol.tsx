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
    <div className="mx-auto grid max-w-7xl gap-10 px-4 py-10 sm:px-6 lg:px-8">
      <section className="grid gap-4">
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

      <section className="grid gap-5">
        <SectionHeading kicker="Standards" title="Protocol dependencies" />
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {standards.map((standard) => (
            <ProtocolCard body={standard.body} key={standard.label} label={standard.label} />
          ))}
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
        <SectionHeading kicker="Internal EIPs" title="Taskmarket protocol surface" />
        <Card>
          <CardContent className="pt-0">
            {internalInterfaces.map((protocolInterface) => (
              <InterfaceRow key={protocolInterface.label} {...protocolInterface} />
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5">
        <SectionHeading kicker="Flow" title="How a paid task becomes settlement" />
        <ol className="grid gap-4 md:grid-cols-2">
          {flow.map((step, index) => (
            <FlowStep key={step.label} index={index + 1} {...step} />
          ))}
        </ol>
      </section>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.75fr)]">
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
