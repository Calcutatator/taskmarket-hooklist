'use client';

import { usePrivy } from '@privy-io/react-auth';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { isPrivyConfigured } from '@/lib/privy-config';

const taskmarketIconSrc = '/taskmarket-final-icon-transparent.svg';

// Minimal campaign header: brand, a single "How it works" anchor, and a subtle
// sign-in for returning users. Deliberately lighter than PublicSiteHeader so a
// cold visitor has no full nav to escape through.
export function TryHeader() {
  if (!isPrivyConfigured()) {
    return (
      <TryHeaderContent
        authenticated={false}
        login={() => undefined}
        ready={false}
        walletConfigurationAvailable={false}
      />
    );
  }

  return <TryHeaderWithPrivy />;
}

function TryHeaderWithPrivy() {
  const { authenticated, login, ready } = usePrivy();

  return (
    <TryHeaderContent
      authenticated={authenticated}
      login={login}
      ready={ready}
      walletConfigurationAvailable
    />
  );
}

function TryHeaderContent({
  authenticated,
  login,
  ready,
  walletConfigurationAvailable,
}: {
  authenticated: boolean;
  login: () => void;
  ready: boolean;
  walletConfigurationAvailable: boolean;
}) {
  return (
    <header className="absolute inset-x-0 top-0 z-30 w-full border-b border-white/10 bg-background/18 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <Link aria-label="Taskmarket home" className="flex items-center gap-3 pr-3" href="/">
          <img
            alt=""
            aria-hidden="true"
            className="size-9 shrink-0"
            height="36"
            src={taskmarketIconSrc}
            width="36"
          />
          <span className="hidden font-display text-lg font-semibold tracking-tight text-foreground min-[380px]:inline">
            Taskmarket
          </span>
        </Link>
        <div className="flex items-center gap-2">
          <Button asChild className="hidden min-[480px]:inline-flex" size="sm" variant="ghost">
            <a href="#how-it-works">How it works</a>
          </Button>
          {authenticated ? (
            <Button asChild size="sm" variant="terminal">
              <a href="#try-builder">Continue brief</a>
            </Button>
          ) : (
            <Button
              disabled={!walletConfigurationAvailable || !ready}
              onClick={() => login()}
              size="sm"
              type="button"
              variant="terminal"
            >
              {walletConfigurationAvailable ? 'Sign in' : 'Unavailable'}
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}

// Trimmed footer: trust anchors for the settlement rails plus a link back to the
// full site. No sprawling nav on the campaign page.
export function TryFooter() {
  return (
    <footer className="border-t border-border/58 bg-background px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4 font-mono text-[0.68rem] font-semibold uppercase text-muted-foreground">
          <span className="flex items-center gap-2">
            <img alt="" aria-hidden="true" className="size-5" src="/usdc-token.svg" />
            USDC settled
          </span>
          <span className="flex items-center gap-2">
            <img alt="" aria-hidden="true" className="size-5" src="/base-network.svg" />
            On Base
          </span>
        </div>
        <Link
          className="font-mono text-[0.68rem] font-semibold uppercase text-muted-foreground transition-colors hover:text-primary"
          href="/"
        >
          Explore the full marketplace
        </Link>
      </div>
    </footer>
  );
}
