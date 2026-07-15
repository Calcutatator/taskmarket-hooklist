'use client';

import { getAccessToken, usePrivy } from '@privy-io/react-auth';
import type { LegalBundle, LegalDocumentType } from '@taskmarket/shared';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { acceptWebLegalBundle, getLegalStatus } from '@/lib/legal-api';
import { clearLegalReceipt, setLegalReceipt } from '@/lib/legal-receipt';

type GateState =
  | { kind: 'idle' | 'checking' | 'accepted' | 'limited' }
  | { kind: 'required'; bundle: LegalBundle }
  | { kind: 'error'; message: string };

const initialChecks = {
  acceptableUse: false,
  privacy: false,
  risk: false,
  terms: false,
};

export function LegalConsentGate({ children }: { children: React.ReactNode }) {
  const { authenticated, logout, ready } = usePrivy();
  const pathname = usePathname() ?? '';
  const [state, setState] = useState<GateState>({ kind: 'idle' });
  const [checks, setChecks] = useState(initialChecks);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const limitedBundleVersion = useRef<string | null>(null);
  const limitedAfterError = useRef(false);

  useEffect(() => {
    if (pathname === '/legal' || pathname.startsWith('/legal/')) {
      setState({ kind: 'idle' });
      return;
    }
    if (!ready) return;
    if (!authenticated) {
      clearLegalReceipt();
      limitedBundleVersion.current = null;
      limitedAfterError.current = false;
      setState({ kind: 'idle' });
      return;
    }

    let cancelled = false;
    setState({ kind: 'checking' });
    void (async () => {
      try {
        const token = await getAccessToken();
        const status = await getLegalStatus(token);
        if (cancelled) return;
        if (status.receipt) setLegalReceipt(status.receipt, status.bundle.version);
        limitedAfterError.current = false;
        if (!status.bundle.acceptanceAvailable || status.accepted) {
          limitedBundleVersion.current = null;
          setState({ kind: 'accepted' });
          return;
        }
        if (limitedBundleVersion.current === status.bundle.version) {
          setState({ kind: 'limited' });
          return;
        }
        setChecks(initialChecks);
        setState({ kind: 'required', bundle: status.bundle });
      } catch (error) {
        if (!cancelled) {
          if (limitedAfterError.current) {
            setState({ kind: 'limited' });
            return;
          }
          setState({
            kind: 'error',
            message: error instanceof Error ? error.message : 'Unable to verify legal status',
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authenticated, pathname, ready]);

  const allChecked = useMemo(() => Object.values(checks).every(Boolean), [checks]);
  const bundle = state.kind === 'required' ? state.bundle : undefined;
  const documentUrls = Object.fromEntries(
    (bundle?.documents ?? []).map((document) => [document.type, document.url])
  ) as Partial<Record<LegalDocumentType, string>>;

  async function accept(): Promise<void> {
    if (!bundle || !allChecked) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error('Your login session expired. Sign in again.');
      const result = await acceptWebLegalBundle(
        {
          acknowledgedRisk: true,
          agreedToAcceptableUse: true,
          agreedToTerms: true,
          bundleDigest: bundle.bundleDigest,
          bundleVersion: bundle.version,
          receivedPrivacyNotice: true,
        },
        token
      );
      if (result.bundleDigest !== bundle.bundleDigest || result.bundleVersion !== bundle.version) {
        throw new Error('The server returned a receipt for a different legal bundle.');
      }
      setLegalReceipt(result.receipt, result.bundleVersion);
      limitedBundleVersion.current = null;
      limitedAfterError.current = false;
      setState({ kind: 'accepted' });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Unable to record acceptance');
    } finally {
      setSubmitting(false);
    }
  }

  async function signOutAndRead(): Promise<void> {
    clearLegalReceipt();
    await logout();
  }

  function continueWithoutAccepting(): void {
    if (state.kind === 'required') {
      limitedBundleVersion.current = state.bundle.version;
    } else if (state.kind === 'error') {
      limitedAfterError.current = true;
    }
    setState({ kind: 'limited' });
  }

  return (
    <>
      {children}
      <Dialog open={state.kind === 'required' || state.kind === 'error'}>
        <DialogContent
          className="max-h-[min(90vh,760px)] max-w-2xl overflow-y-auto [&>button]:hidden"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          {state.kind === 'error' ? (
            <>
              <DialogHeader>
                <DialogTitle>Legal status unavailable</DialogTitle>
                <DialogDescription>
                  Taskmarket could not verify whether the current policies have been accepted. New
                  marketplace actions remain unavailable until verification succeeds.
                </DialogDescription>
              </DialogHeader>
              <p className="rounded-lg border border-destructive/35 bg-destructive/8 p-3 text-sm text-destructive">
                {state.message}
              </p>
              <DialogFooter>
                <Button onClick={() => window.location.reload()} type="button">
                  Retry
                </Button>
                <Button onClick={continueWithoutAccepting} type="button" variant="outline">
                  Continue with limited access
                </Button>
                <Button onClick={signOutAndRead} type="button" variant="ghost">
                  Sign out
                </Button>
              </DialogFooter>
            </>
          ) : bundle ? (
            <>
              <DialogHeader>
                <DialogTitle>Review Taskmarket&apos;s legal policies</DialogTitle>
                <DialogDescription>
                  Version {bundle.version} applies before you can fund, create, submit, bid, pitch,
                  evaluate, or otherwise begin new marketplace activity. Each policy opens in a new
                  page.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-3 rounded-xl border border-border/70 bg-background/45 p-4 text-sm">
                <div className="flex items-start gap-3">
                  <Checkbox
                    aria-labelledby="legal-terms-label"
                    checked={checks.terms}
                    id="legal-terms"
                    onCheckedChange={(checked) =>
                      setChecks((current) => ({ ...current, terms: checked === true }))
                    }
                  />
                  <span id="legal-terms-label">
                    I agree to the{' '}
                    <a
                      className="font-semibold text-primary underline-offset-4 hover:underline"
                      href={documentUrls.terms_of_service ?? '/legal/terms'}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Terms of Service
                    </a>
                    .
                  </span>
                </div>
                <div className="flex items-start gap-3">
                  <Checkbox
                    aria-labelledby="legal-acceptable-use-label"
                    checked={checks.acceptableUse}
                    id="legal-acceptable-use"
                    onCheckedChange={(checked) =>
                      setChecks((current) => ({ ...current, acceptableUse: checked === true }))
                    }
                  />
                  <span id="legal-acceptable-use-label">
                    I agree to the{' '}
                    <a
                      className="font-semibold text-primary underline-offset-4 hover:underline"
                      href={documentUrls.acceptable_use_policy ?? '/legal/acceptable-use'}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Acceptable Use Policy
                    </a>
                    .
                  </span>
                </div>
                <div className="flex items-start gap-3">
                  <Checkbox
                    aria-labelledby="legal-risk-label"
                    checked={checks.risk}
                    id="legal-risk"
                    onCheckedChange={(checked) =>
                      setChecks((current) => ({ ...current, risk: checked === true }))
                    }
                  />
                  <span id="legal-risk-label">
                    I acknowledge the{' '}
                    <a
                      className="font-semibold text-primary underline-offset-4 hover:underline"
                      href={documentUrls.risk_disclosure ?? '/legal/risks'}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Risk Disclosure
                    </a>
                    , including smart-contract, stablecoin, agent, and counterparty risks.
                  </span>
                </div>
                <div className="flex items-start gap-3">
                  <Checkbox
                    aria-labelledby="legal-privacy-label"
                    checked={checks.privacy}
                    id="legal-privacy"
                    onCheckedChange={(checked) =>
                      setChecks((current) => ({ ...current, privacy: checked === true }))
                    }
                  />
                  <span id="legal-privacy-label">
                    I confirm that I received the{' '}
                    <a
                      className="font-semibold text-primary underline-offset-4 hover:underline"
                      href={documentUrls.privacy_policy ?? '/legal/privacy'}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Privacy Policy
                    </a>
                    . This is an acknowledgement of notice, not blanket consent to all processing.
                  </span>
                </div>
              </div>

              <p className="rounded-lg border border-border/70 bg-muted/35 p-3 text-sm leading-6 text-foreground">
                {bundle.acceptanceStatement}
              </p>

              <p className="text-xs leading-5 text-muted-foreground">
                Taskmarket records the policy versions, content hashes, time, session evidence, IP
                address, and user agent associated with this acceptance. Refusing does not block
                public reads or designated terminal settlement, withdrawal, refund, cancellation,
                appeal, data, and logout actions.
              </p>
              {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}
              <DialogFooter>
                <Button disabled={!allChecked || submitting} onClick={accept} type="button">
                  {submitting ? 'Recording acceptance...' : 'Accept and continue'}
                </Button>
                <Button onClick={continueWithoutAccepting} type="button" variant="outline">
                  Continue without accepting
                </Button>
                <Button onClick={signOutAndRead} type="button" variant="ghost">
                  Sign out
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
