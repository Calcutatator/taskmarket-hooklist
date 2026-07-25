import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DashboardProtocolContent as DashboardProtocolContentType } from './protocol-dashboard';

// protocol-dashboard.tsx computes chainId/explorerUrl as module-level consts from
// NEXT_PUBLIC_CHAIN_ID/NEXT_PUBLIC_EXPLORER_URL, frozen at first import. The hrefs this
// file asserts assume the mainnet default (chain 8453), so the env must be pinned and the
// module freshly imported per test -- otherwise an ambient NEXT_PUBLIC_CHAIN_ID (e.g. a
// local .env pointing at testnet for dev) leaks into the module cache and flips every
// expected BaseScan href to sepolia.basescan.org.
async function loadDashboardProtocolContent(): Promise<typeof DashboardProtocolContentType> {
  const mod = await import('./protocol-dashboard');
  return mod.DashboardProtocolContent;
}

describe('DashboardProtocolContent', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv('NEXT_PUBLIC_CHAIN_ID', '8453');
    vi.stubEnv('NEXT_PUBLIC_EXPLORER_URL', undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders the hero, standards, flow, surface, selectors, safety rules, and CTAs', async () => {
    const DashboardProtocolContent = await loadDashboardProtocolContent();
    render(<DashboardProtocolContent />);

    expect(
      screen.getByRole('heading', { level: 1, name: /task market protocol/i })
    ).toBeInTheDocument();

    expect(screen.getByText('ERC-8195 TMP')).toBeInTheDocument();
    expect(screen.getByText('ERC-8194 PGTR')).toBeInTheDocument();
    expect(screen.getByText('x402 + EIP-3009')).toBeInTheDocument();
    expect(screen.getByText('ERC-8004')).toBeInTheDocument();
    expect(screen.getByText('ERC-165')).toBeInTheDocument();
    expect(screen.getByText('ERC-20 USDC')).toBeInTheDocument();

    expect(screen.getAllByText(/ITMPMode/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/ITMPFees/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/IPGTRForwarder/i).length).toBeGreaterThan(0);

    expect(screen.getByText(/Agent pays over HTTP/i)).toBeInTheDocument();
    expect(screen.getByText(/Ratings write ERC-8004 feedback/i)).toBeInTheDocument();

    expect(screen.getByText(/TMP\.mode\.bounty/i)).toBeInTheDocument();
    expect(screen.getByText(/TMP\.auction\.english/i)).toBeInTheDocument();
    expect(screen.getAllByText(/refundExpired\(\)/i).length).toBeGreaterThan(0);

    expect(screen.getByTestId('dashboard-protocol-cta-create')).toHaveAttribute(
      'href',
      '/dashboard/tasks/new'
    );
    expect(screen.getByTestId('dashboard-protocol-cta-build')).toHaveAttribute(
      'href',
      '/dashboard/for-agents'
    );

    const sectionNavigation = screen.getByRole('navigation', { name: /protocol sections/i });
    expect(within(sectionNavigation).getByRole('link', { name: 'Standards' })).toHaveAttribute(
      'href',
      '#standards'
    );
    expect(within(sectionNavigation).getByRole('link', { name: 'Internal EIPs' })).toHaveAttribute(
      'href',
      '#internal-eips'
    );
    expect(within(sectionNavigation).getByRole('link', { name: 'Flow' })).toHaveAttribute(
      'href',
      '#settlement-flow'
    );
    expect(within(sectionNavigation).getByRole('link', { name: 'Mode selectors' })).toHaveAttribute(
      'href',
      '#mode-selectors'
    );
    expect(within(sectionNavigation).getByRole('link', { name: 'Contracts' })).toHaveAttribute(
      'href',
      '#deployed-contracts'
    );
    expect(within(sectionNavigation).getByRole('link', { name: 'Safety' })).toHaveAttribute(
      'href',
      '#safety'
    );

    const mobileInterfaces = screen.getByTestId('dashboard-protocol-mobile-interfaces');
    const disclosures = mobileInterfaces.querySelectorAll('details');
    expect(disclosures).toHaveLength(6);
    expect(Array.from(disclosures).every((details) => !details.open)).toBe(true);
    expect(document.querySelector('#interfaces')).toBeInTheDocument();
  });

  it('links each standard to the correct EIP source and opens in a new tab', async () => {
    const DashboardProtocolContent = await loadDashboardProtocolContent();
    render(<DashboardProtocolContent />);

    const expectedLinks: Array<[string, string]> = [
      ['EIP-8195', 'https://eips.ethereum.org/EIPS/eip-8195'],
      ['EIP-8194', 'https://eips.ethereum.org/EIPS/eip-8194'],
      ['x402.org', 'https://www.x402.org/'],
      ['EIP-3009', 'https://eips.ethereum.org/EIPS/eip-3009'],
      ['EIP-8004', 'https://eips.ethereum.org/EIPS/eip-8004'],
      ['EIP-165', 'https://eips.ethereum.org/EIPS/eip-165'],
      ['EIP-20', 'https://eips.ethereum.org/EIPS/eip-20'],
    ];

    for (const [label, href] of expectedLinks) {
      const link = screen.getByRole('link', { name: new RegExp(label, 'i') });
      expect(link).toHaveAttribute('href', href);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noreferrer');
    }
  });

  it('lists deployed contracts with BaseScan address links that open in a new tab', async () => {
    const DashboardProtocolContent = await loadDashboardProtocolContent();
    render(<DashboardProtocolContent />);

    const contracts = screen.getByTestId('dashboard-protocol-contracts-list');

    expect(within(contracts).getByText('TaskMarket')).toBeInTheDocument();
    expect(within(contracts).getByText('USDC')).toBeInTheDocument();
    expect(within(contracts).getByText(/Identity Registry/i)).toBeInTheDocument();
    expect(within(contracts).getByText(/Reputation Registry/i)).toBeInTheDocument();

    const expectedHrefs = [
      'https://basescan.org/address/0xDDc6cC3e4D11c1f3527B867C7DAD4ED9869C33f7',
      'https://basescan.org/address/0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      'https://basescan.org/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
      'https://basescan.org/address/0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
    ];

    const links = within(contracts).getAllByRole('link');
    for (const href of expectedHrefs) {
      const match = links.find((link) => link.getAttribute('href') === href);
      expect(match, `expected a link with href ${href}`).toBeTruthy();
      expect(match).toHaveAttribute('target', '_blank');
      expect(match).toHaveAttribute('rel', 'noreferrer');
    }
  });
});
