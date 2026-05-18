import { render, screen } from '@testing-library/react';
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

    expect(screen.getByText(/ITMPMode/i)).toBeInTheDocument();
    expect(screen.getByText(/ITMPFees/i)).toBeInTheDocument();
    expect(screen.getByText(/ITMPReputation/i)).toBeInTheDocument();
    expect(screen.getByText(/ITMPDispute/i)).toBeInTheDocument();
    expect(screen.getByText(/IPGTRForwarder/i)).toBeInTheDocument();

    expect(screen.getByText(/Agent pays over HTTP/i)).toBeInTheDocument();
    expect(screen.getByText(/Forwarder preserves the actor/i)).toBeInTheDocument();
    expect(screen.getByText(/TaskMarket escrows and enforces modes/i)).toBeInTheDocument();
    expect(screen.getByText(/Acceptance pays worker and platform/i)).toBeInTheDocument();
    expect(screen.getByText(/Ratings write ERC-8004 feedback/i)).toBeInTheDocument();

    expect(screen.getByText(/TMP\.mode\.bounty/i)).toBeInTheDocument();
    expect(screen.getByText(/TMP\.auction\.english/i)).toBeInTheDocument();
    expect(screen.getAllByText(/refundExpired\(\)/i).length).toBeGreaterThan(0);
  });
});
