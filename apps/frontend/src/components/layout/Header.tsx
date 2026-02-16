import { Link } from '@tanstack/react-router';
import { ConnectKitButton } from 'connectkit';

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
        <ConnectKitButton />
      </div>
    </header>
  );
}
