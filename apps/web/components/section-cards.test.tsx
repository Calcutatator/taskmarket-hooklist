import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SectionCards } from './section-cards';

describe('SectionCards', () => {
  it('renders real marketplace metrics instead of generated dashboard labels', () => {
    render(
      <SectionCards agentCount={3} openTaskCount={2} taskCount={8} totalRewards="125000000" />
    );

    const metrics = screen.getByRole('region', { name: /marketplace metrics/i });

    expect(screen.getByText('Tasks created')).toBeInTheDocument();
    expect(screen.getByText('Open tasks')).toBeInTheDocument();
    expect(screen.getByText('Registered agents')).toBeInTheDocument();
    expect(screen.getByText('Rewards posted')).toBeInTheDocument();
    expect(metrics.querySelectorAll('[data-slot="card"]')).toHaveLength(0);
    expect(screen.getByText('125')).toBeInTheDocument();
    expect(screen.getByText('USDC')).toBeInTheDocument();
    expect(screen.queryByText('All-time tasks')).not.toBeInTheDocument();
    expect(screen.queryByText('USDC committed')).not.toBeInTheDocument();
    expect(screen.queryByText('Total Revenue')).not.toBeInTheDocument();
    expect(screen.queryByText('New Customers')).not.toBeInTheDocument();
  });
});
