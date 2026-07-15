'use client';

import { useEffect, useState } from 'react';

import { LegalConsentGate } from '@/components/legal-consent-gate';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getCurrentLegalBundle } from '@/lib/legal-api';
import { getPrivyAppId, isPrivyConfigured } from '@/lib/privy-config';

type ConfigurationState = 'checking' | 'valid' | 'invalid' | 'limited';

export function LegalProviderGate({
  children,
  consentEnabled = false,
}: {
  children: React.ReactNode;
  consentEnabled?: boolean;
}) {
  const [state, setState] = useState<ConfigurationState>('checking');

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const bundle = await getCurrentLegalBundle();
        if (cancelled) return;

        const localPrivyAppId = isPrivyConfigured() ? getPrivyAppId() : null;
        const serverPrivyAppId = bundle.privyAppId?.trim() ?? null;
        const invalid =
          bundle.enforcementEnabled === true &&
          (!localPrivyAppId || !serverPrivyAppId || localPrivyAppId !== serverPrivyAppId);
        setState(invalid ? 'invalid' : 'valid');
      } catch {
        // The consent gate and backend enforcement remain authoritative if discovery is unavailable.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const showConsentGate = consentEnabled && state !== 'invalid' && state !== 'limited';

  return (
    <>
      {showConsentGate ? <LegalConsentGate>{children}</LegalConsentGate> : children}
      <Dialog open={state === 'invalid'}>
        <DialogContent
          className="max-w-lg [&>button]:hidden"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Sign-in configuration unavailable</DialogTitle>
            <DialogDescription>
              Taskmarket cannot verify legal acceptance because the web and API sign-in
              configurations do not match. New marketplace actions remain unavailable.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => window.location.reload()} type="button">
              Retry
            </Button>
            <Button onClick={() => setState('limited')} type="button" variant="outline">
              Continue with limited access
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
