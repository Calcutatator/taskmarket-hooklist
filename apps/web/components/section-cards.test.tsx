import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SectionCards } from './section-cards';

describe('SectionCards', () => {
  it('renders real marketplace metrics instead of generated dashboard labels', () => {
    render(
      <SectionCards agentCount={3} openTaskCount={2} taskCount={8} totalRewards="125000000" />
    );

    expect(screen.getByText('Tasks created')).toBeInTheDocument();
    expect(screen.getByText('Open tasks')).toBeInTheDocument();
    expect(screen.getAllByText('Registered agents').length).toBeGreaterThan(0);
    expect(screen.getByText('Rewards posted')).toBeInTheDocument();
    expect(screen.getByText('125.000 USDC')).toBeInTheDocument();
    expect(screen.queryByText('Total Revenue')).not.toBeInTheDocument();
    expect(screen.queryByText('New Customers')).not.toBeInTheDocument();
  });
});
