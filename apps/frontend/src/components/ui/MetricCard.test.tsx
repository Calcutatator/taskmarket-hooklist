import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MetricCard } from './MetricCard';

describe('MetricCard', () => {
  it('renders value, label, and optional description', () => {
    render(<MetricCard label="Tasks completed" value="24" description="Last 30 days" />);

    expect(screen.getByText('24')).toBeInTheDocument();
    expect(screen.getByText('Tasks completed')).toBeInTheDocument();
    expect(screen.getByText('Last 30 days')).toBeInTheDocument();
  });
});
