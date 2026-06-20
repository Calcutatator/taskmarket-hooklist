import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AnimatedNumber } from './animated-number';
import { formatNumber } from '@/lib/format';

// In the vitest env motion is disabled, so AnimatedNumber renders a plain span.
describe('AnimatedNumber', () => {
  it('applies the format function to numeric values', () => {
    render(<AnimatedNumber format={(value) => formatNumber(Number(value))} value={1234} />);
    expect(screen.getByText('1,234')).toBeInTheDocument();
  });

  it('passes string values through unchanged', () => {
    render(<AnimatedNumber value="25.000 USDC" />);
    expect(screen.getByText('25.000 USDC')).toBeInTheDocument();
  });
});
