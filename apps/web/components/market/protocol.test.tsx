import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProtocolContent } from './protocol';

describe('ProtocolContent', () => {
  it('explains the protocol standards, internal interfaces, and settlement flow', () => {
    render(<ProtocolContent />);

    expect(
      screen.getByRole('heading', {
        name: /task market protocol/i,
      })
    ).toBeInTheDocument();

    expect(screen.getByText('ERC-8195 TMP')).toBeInTheDocument();
    expect(screen.getByText('ERC-8194 PGTR')).toBeInTheDocument();
    expect(screen.getByText('x402 + EIP-3009')).toBeInTheDocument();
    expect(screen.getByText('ERC-8004')).toBeInTheDocument();
    expect(screen.getByText('ERC-165')).toBeInTheDocument();
    expect(screen.getByText('ERC-20 USDC')).toBeInTheDocument();

    expect(screen.getAllByText(/ITMPMode/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/ITMPFees/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/ITMPReputation/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/ITMPDispute/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/IPGTRForwarder/i).length).toBeGreaterThan(0);

    expect(screen.getByText(/Agent pays over HTTP/i)).toBeInTheDocument();
    expect(screen.getByText(/Forwarder preserves the actor/i)).toBeInTheDocument();
    expect(screen.getByText(/TaskMarket escrows and enforces modes/i)).toBeInTheDocument();
    expect(screen.getByText(/Acceptance pays worker and platform/i)).toBeInTheDocument();
    expect(screen.getByText(/Ratings write ERC-8004 feedback/i)).toBeInTheDocument();

    expect(screen.getByText(/TMP\.mode\.bounty/i)).toBeInTheDocument();
    expect(screen.getByText(/TMP\.auction\.english/i)).toBeInTheDocument();
    expect(screen.getAllByText(/refundExpired\(\)/i).length).toBeGreaterThan(0);

    const navigation = screen.getByRole('navigation', { name: /protocol sections/i });
    expect(within(navigation).getByRole('link', { name: 'Standards' })).toHaveAttribute(
      'href',
      '#standards'
    );
    expect(within(navigation).getByRole('link', { name: 'Internal EIPs' })).toHaveAttribute(
      'href',
      '#internal-eips'
    );
    expect(within(navigation).getByRole('link', { name: 'Flow' })).toHaveAttribute(
      'href',
      '#settlement-flow'
    );
    expect(within(navigation).getByRole('link', { name: 'Mode selectors' })).toHaveAttribute(
      'href',
      '#mode-selectors'
    );
    expect(within(navigation).getByRole('link', { name: 'Safety' })).toHaveAttribute(
      'href',
      '#safety'
    );

    const mobileInterfaces = screen.getByTestId('protocol-mobile-interfaces');
    const disclosures = mobileInterfaces.querySelectorAll('details');
    expect(disclosures).toHaveLength(6);
    expect(Array.from(disclosures).every((details) => !details.open)).toBe(true);
    expect(document.querySelector('#interfaces')).toBeInTheDocument();
  });
});
