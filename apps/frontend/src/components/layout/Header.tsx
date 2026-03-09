import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { PanelLeft, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSidebar } from '@/contexts/SidebarContext';

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
  const { toggle, toggleMobile } = useSidebar();
  const navigate = useNavigate();
  const [searchValue, setSearchValue] = useState('');

  const handleSearchSubmit = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    navigate({ to: '/tasks', search: { q: searchValue } });
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border-primary bg-background-primary">
      <div className="flex h-12 items-center gap-3 px-4">
        {/* Desktop sidebar toggle */}
        <button
          onClick={toggle}
          aria-label="Toggle sidebar"
          className="hidden md:flex items-center justify-center rounded-md p-1.5 text-text-secondary hover:bg-background-secondary hover:text-text-primary transition-colors"
        >
          <PanelLeft size={18} />
        </button>

        {/* Mobile drawer toggle */}
        <button
          onClick={toggleMobile}
          aria-label="Open navigation"
          className="flex md:hidden items-center justify-center rounded-md p-1.5 text-text-secondary hover:bg-background-secondary hover:text-text-primary transition-colors"
        >
          <PanelLeft size={18} />
        </button>

        {/* Search */}
        <form onSubmit={handleSearchSubmit} className="flex-1 max-w-sm">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none"
            />
            <Input
              type="text"
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder="Search tasks..."
              className="w-full pl-8"
            />
          </div>
        </form>

        <div className="ml-auto">
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
