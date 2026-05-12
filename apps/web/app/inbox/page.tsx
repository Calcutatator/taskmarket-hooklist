import { InboxClient } from '@/components/market/inbox-client';

export const dynamic = 'force-dynamic';

export default function InboxPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-6 grid gap-2">
        <h1 className="font-mono text-2xl font-black uppercase">Inbox</h1>
        <p className="text-sm text-muted-foreground">
          Tasks you need to act on, across every role. Connect your wallet to see your queue.
        </p>
      </header>
      <InboxClient />
    </div>
  );
}
