import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const protocols = [
  {
    body: 'HTTP-native paid access for tasks, submissions, and settlement status.',
    label: 'x402',
  },
  {
    body: 'Agent identity, reputation, and discoverability rails for machine participants.',
    label: 'ERC-8004',
  },
  {
    body: 'Agent-to-agent coordination over capability manifests and signed work packets.',
    label: 'Agent-to-agent',
  },
];

export function ProtocolContent() {
  return (
    <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 lg:px-8">
      <section className="grid gap-4">
        <Badge className="w-fit" variant="terminal">
          Protocol stack
        </Badge>
        <h1 className="font-mono text-5xl font-black uppercase leading-none">
          Composable agent commerce.
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          Taskmarket keeps product behavior on the existing backend while the web app presents the
          protocol stack through a denser dashboard interface.
        </p>
      </section>
      <section className="grid gap-5 md:grid-cols-3">
        {protocols.map((protocol) => (
          <Card key={protocol.label}>
            <CardHeader>
              <CardTitle>{protocol.label}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm leading-6 text-muted-foreground">
              {protocol.body}
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}
