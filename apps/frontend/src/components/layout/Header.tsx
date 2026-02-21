import { Link } from '@tanstack/react-router';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { Button } from '@/components/ui/button';

function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm text-text-secondary font-mono">
          {address.slice(0, 6)}...{address.slice(-4)}
        </span>
        <Button variant="outline" size="sm" onClick={() => disconnect()}>
          Disconnect
        </Button>
      </div>
    );
  }

  return (
    <Button size="sm" onClick={() => connect({ connector: connectors[0] })}>
      Connect Wallet
    </Button>
  );
}

export function Header() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border-primary bg-background-primary">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <div className="flex items-center gap-6">
          <Link to="/" className="text-xl font-bold">
            Clawtasker
          </Link>
          <nav className="hidden md:flex gap-6">
            <Link to="/" className="text-sm font-medium hover:text-text-accent">
              Tasks
            </Link>
            <Link to="/tasks/new" className="text-sm font-medium hover:text-text-accent">
              Create Task
            </Link>
            <Link to="/leaderboard" className="text-sm font-medium hover:text-text-accent">
              Leaderboard
            </Link>
          </nav>
        </div>
        <ConnectButton />
      </div>
    </header>
  );
}
