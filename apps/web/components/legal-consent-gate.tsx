'use client';

import { getAccessToken, usePrivy } from '@privy-io/react-auth';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

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
import { getBrowserApiBaseUrl } from '@/lib/api/config';
import { clearLegalReceipt, getLegalReceiptHeaders, setLegalReceipt } from '@/lib/legal-receipt';

type LegalDocumentType =
  | 'terms_of_service'
  | 'privacy_policy'
  | 'risk_disclosure'
  | 'acceptable_use_policy';

type LegalBundle = {
  acceptanceAvailable: boolean;
  acceptanceStatement: string;
  documents: Array<{
    title: string;
    type: LegalDocumentType;
    url: string;
  }>;
  enforcementEnabled: boolean;
  status: 'draft' | 'approved';
  version: string;
};

type GateState =
  | { kind: 'idle' | 'checking' | 'accepted' }
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

  useEffect(() => {
    if (pathname === '/legal' || pathname.startsWith('/legal/')) {
      setState({ kind: 'idle' });
      return;
    }
    if (!ready) return;
    if (!authenticated) {
      clearLegalReceipt();
      setState({ kind: 'idle' });
      return;
    }

    let cancelled = false;
    setState({ kind: 'checking' });
    void (async () => {
      try {
        const token = await getAccessToken();
        const response = await fetch(`${getBrowserApiBaseUrl()}/api/legal/status`, {
          headers: {
            ...getLegalReceiptHeaders(),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        if (!response.ok) throw new Error(`Legal status check failed (${response.status})`);
        const status = (await response.json()) as {
          accepted: boolean;
          bundle: LegalBundle;
          receipt?: string;
        };
        if (cancelled) return;
        if (status.receipt) setLegalReceipt(status.receipt, status.bundle.version);
        if (!status.bundle.enforcementEnabled || status.accepted) {
          setState({ kind: 'accepted' });
          return;
        }
        setChecks(initialChecks);
        setState({ kind: 'required', bundle: status.bundle });
      } catch (error) {
        if (!cancelled) {
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
      const response = await fetch(`${getBrowserApiBaseUrl()}/api/legal/accept/web`, {
        body: JSON.stringify({
          acknowledgedRisk: true,
          agreedToAcceptableUse: true,
          agreedToTerms: true,
          bundleVersion: bundle.version,
          receivedPrivacyNotice: true,
        }),
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
      });
      const body = (await response.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
        receipt?: string;
        bundleVersion?: string;
      };
      if (!response.ok || !body.receipt || !body.bundleVersion) {
        throw new Error(body.message ?? body.error ?? `Acceptance failed (${response.status})`);
      }
      setLegalReceipt(body.receipt, body.bundleVersion);
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
                <Button onClick={signOutAndRead} type="button" variant="outline">
                  Sign out and continue read-only
                </Button>
              </DialogFooter>
            </>
          ) : bundle ? (
            <>
              <DialogHeader>
                <DialogTitle>Review Taskmarket&apos;s legal policies</DialogTitle>
                <DialogDescription>
                  Version {bundle.version} applies before you can fund, accept, submit, evaluate, or
                  otherwise begin new marketplace activity. Each policy opens in a new page.
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

              <p className="text-xs leading-5 text-muted-foreground">
                Taskmarket records the policy versions, content hashes, time, session evidence, IP
                address, and user agent associated with this acceptance. Refusing does not block
                public reads or designated withdrawal, refund, cancellation, data, and logout
                actions.
              </p>
              {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}
              <DialogFooter>
                <Button disabled={!allChecked || submitting} onClick={accept} type="button">
                  {submitting ? 'Recording acceptance...' : 'Accept and continue'}
                </Button>
                <Button onClick={signOutAndRead} type="button" variant="outline">
                  Sign out and continue read-only
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
