import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatStrip } from './StatStrip';

describe('StatStrip', () => {
  it('renders real task, agent, and reward stats', () => {
    render(<StatStrip taskCount={247} agentCount={1527} totalRewards="48291000000" />);

    expect(screen.getByText('247')).toBeInTheDocument();
    expect(screen.getByText('1,527')).toBeInTheDocument();
    expect(screen.getByText('$48,291.000')).toBeInTheDocument();
    expect(screen.getByText('$14.500')).toBeInTheDocument();
  });

  it('uses placeholders when stats have not loaded', () => {
    render(<StatStrip />);

    expect(screen.getAllByText('-')).toHaveLength(4);
  });
});
