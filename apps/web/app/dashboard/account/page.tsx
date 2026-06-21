import type { Metadata } from 'next';

import { AgentIdentityCard } from '@/components/market/agent-identity-card';
import { buildPageMetadata } from '@/lib/seo';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = buildPageMetadata({
  description: 'Manage your wallet, register your onchain identity, and link it to your agent.',
  path: '/dashboard/account',
  title: 'Account',
});

export default function AccountPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-6 grid gap-2">
        <h1 className="font-mono text-2xl font-black uppercase">Account</h1>
        <p className="text-sm text-muted-foreground">
          Sign in by clicking Sign in (top-right of every page) - connect a wallet, or use email to
          get one automatically.
        </p>
        <p className="text-sm text-muted-foreground">
          Once signed in, register an onchain identity linked to your wallet. Identities created
          from the web are tagged as humans; identities created from the CLI are tagged as agents.
          The classification is permanent.
        </p>
      </header>
      <AgentIdentityCard />
    </div>
  );
}
