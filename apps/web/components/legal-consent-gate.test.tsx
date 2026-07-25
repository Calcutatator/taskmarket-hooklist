import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getAccessToken, logout, routing } = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  logout: vi.fn(),
  routing: { pathname: '/dashboard' },
}));

vi.mock('@privy-io/react-auth', () => ({
  getAccessToken,
  usePrivy: () => ({ authenticated: true, logout, ready: true }),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => routing.pathname,
}));

import { LegalConsentGate } from './legal-consent-gate';

const bundle = {
  acceptanceAvailable: true,
  acceptanceStatement:
    'I agree to the Terms and Acceptable Use Policy, acknowledge the risks, and received the Privacy Policy.',
  bundleDigest: `sha256:${'a'.repeat(64)}`,
  documents: [
    {
      contentHash: `sha256:${'b'.repeat(64)}`,
      slug: 'terms',
      summary: 'Marketplace terms.',
      title: 'Terms of Service',
      type: 'terms_of_service',
      url: 'https://api.taskmarket.example/legal/terms',
      version: '2026-07-1',
    },
    {
      contentHash: `sha256:${'c'.repeat(64)}`,
      slug: 'privacy',
      summary: 'Privacy notice.',
      title: 'Privacy Policy',
      type: 'privacy_policy',
      url: 'https://api.taskmarket.example/legal/privacy',
      version: '2026-07-1',
    },
    {
      contentHash: `sha256:${'d'.repeat(64)}`,
      slug: 'risks',
      summary: 'Marketplace risks.',
      title: 'Risk Disclosure',
      type: 'risk_disclosure',
      url: 'https://api.taskmarket.example/legal/risks',
      version: '2026-07-1',
    },
    {
      contentHash: `sha256:${'e'.repeat(64)}`,
      slug: 'acceptable-use',
      summary: 'Acceptable use rules.',
      title: 'Acceptable Use Policy',
      type: 'acceptable_use_policy',
      url: 'https://api.taskmarket.example/legal/acceptable-use',
      version: '2026-07-1',
    },
  ],
  effectiveAt: '2026-07-15T00:00:00.000Z',
  enforcementEnabled: true,
  privyAppId: '1234567890123456789012345',
  publishedAt: '2026-07-01T00:00:00.000Z',
  status: 'approved',
  version: '2026-07-1',
};

describe('LegalConsentGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    routing.pathname = '/dashboard';
    getAccessToken.mockResolvedValue('privy-token');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ accepted: false, bundle }) })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            acceptedAt: '2026-07-15T00:00:00.000Z',
            bundleDigest: bundle.bundleDigest,
            bundleVersion: bundle.version,
            receipt: 'receipt-1',
          }),
        })
    );
  });

  it('requires every separate agreement and acknowledgement before recording assent', async () => {
    const user = userEvent.setup();
    render(
      <LegalConsentGate>
        <div>market</div>
      </LegalConsentGate>
    );

    const accept = await screen.findByRole('button', { name: 'Accept and continue' });
    expect(accept).toBeDisabled();
    expect(screen.getByText(bundle.acceptanceStatement)).toBeInTheDocument();

    const termsCheckbox = screen.getByRole('checkbox', { name: /agree to the Terms of Service/i });
    const termsRow = screen.getByTestId('legal-consent-terms');
    expect(termsRow).toHaveClass('min-h-11');
    await user.click(screen.getByRole('link', { name: 'Terms of Service' }));
    expect(termsCheckbox).not.toBeChecked();
    await user.click(screen.getByTestId('legal-consent-terms-target'));
    expect(termsCheckbox).toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: /agree to the Acceptable Use Policy/i }));
    await user.click(screen.getByRole('checkbox', { name: /acknowledge the Risk Disclosure/i }));
    expect(accept).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /received the Privacy Policy/i }));
    expect(accept).toBeEnabled();

    await user.click(accept);

    await waitFor(() => expect(localStorage.getItem('taskmarket:legal-receipt')).toBe('receipt-1'));
    expect(screen.queryByRole('button', { name: 'Accept and continue' })).not.toBeInTheDocument();
  });

  it('leaves policy pages readable while acceptance is pending', async () => {
    routing.pathname = '/legal/terms';

    render(
      <LegalConsentGate>
        <div>policy text</div>
      </LegalConsentGate>
    );

    expect(screen.getByText('policy text')).toBeInTheDocument();
    await waitFor(() => expect(fetch).not.toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Accept and continue' })).not.toBeInTheDocument();
  });

  it('lets a signed-in user continue to recovery and read-only features without accepting', async () => {
    const user = userEvent.setup();
    render(
      <LegalConsentGate>
        <div>market recovery controls</div>
      </LegalConsentGate>
    );

    await user.click(await screen.findByRole('button', { name: 'Continue without accepting' }));

    expect(screen.getByText('market recovery controls')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept and continue' })).not.toBeInTheDocument();
    expect(logout).not.toHaveBeenCalled();
  });

  it('clears every client authorization cache before signing out', async () => {
    const user = userEvent.setup();
    localStorage.setItem('taskmarket:legal-receipt', 'receipt');
    sessionStorage.setItem('taskmarket:auth-return-intent', '{}');
    sessionStorage.setItem('taskmarket:task-access:private-task', 'grant');

    render(
      <LegalConsentGate>
        <div>market</div>
      </LegalConsentGate>
    );

    await user.click(await screen.findByRole('button', { name: 'Sign out' }));

    expect(localStorage.getItem('taskmarket:legal-receipt')).toBeNull();
    expect(sessionStorage.getItem('taskmarket:auth-return-intent')).toBeNull();
    expect(sessionStorage.getItem('taskmarket:task-access:private-task')).toBeNull();
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('supports acceptance rollout before write enforcement is enabled', async () => {
    vi.mocked(fetch)
      .mockReset()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accepted: false, bundle: { ...bundle, enforcementEnabled: false } }),
      } as Response);

    render(
      <LegalConsentGate>
        <div>market</div>
      </LegalConsentGate>
    );

    expect(await screen.findByRole('button', { name: 'Accept and continue' })).toBeInTheDocument();
  });
});
