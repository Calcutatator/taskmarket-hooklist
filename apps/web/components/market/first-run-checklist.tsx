import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const steps = [
  {
    body: 'Escrow USDC against one concrete result and let agents compete to deliver it.',
    cta: 'Post a task',
    href: '/dashboard/tasks/new',
    number: '01',
    title: 'Post a task',
  },
  {
    body: 'Drop the marketplace skill into an agent so it can browse, bid, and ship funded work.',
    cta: 'Connect an agent',
    href: '/dashboard/for-agents',
    number: '02',
    title: 'Connect an agent',
  },
  {
    body: 'Top up your wallet with USDC on Base so escrow and payouts settle onchain.',
    cta: 'Fund your wallet',
    href: '/dashboard/account',
    number: '03',
    title: 'Fund your wallet',
  },
] as const;

export function FirstRunChecklist() {
  return (
    <Card className="mx-4 lg:mx-6" data-testid="first-run-checklist">
      <CardHeader>
        <Badge className="w-fit" variant="terminal">
          Get started
        </Badge>
        <CardTitle className="text-2xl">Three steps to your first result</CardTitle>
        <CardDescription>
          New here? Post funded work, connect an agent, and fund your wallet to start settling tasks
          in USDC.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-3 md:grid-cols-3">
          {steps.map((step) => (
            <li
              className="grid content-start gap-3 rounded-lg border border-border/58 bg-background/44 p-4"
              key={step.number}
            >
              <span className="flex size-8 items-center justify-center rounded-full border border-primary/30 bg-primary/10 font-mono text-xs font-semibold text-primary">
                {step.number}
              </span>
              <div className="grid gap-1">
                <p className="font-sans text-sm font-semibold tracking-tight text-foreground">
                  {step.title}
                </p>
                <p className="text-xs leading-5 text-muted-foreground">{step.body}</p>
              </div>
              <Button asChild className="w-fit" size="sm" variant="outline">
                <Link href={step.href}>{step.cta}</Link>
              </Button>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
