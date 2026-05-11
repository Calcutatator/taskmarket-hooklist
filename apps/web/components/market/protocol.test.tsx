import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProtocolContent } from './protocol';

describe('ProtocolContent', () => {
  it('renders the core protocol standards from the old site', () => {
    render(<ProtocolContent />);

    expect(screen.getByText(/x402/i)).toBeInTheDocument();
    expect(screen.getByText(/erc-8004/i)).toBeInTheDocument();
    expect(screen.getAllByText(/agent-to-agent/i).length).toBeGreaterThan(0);
  });
});
