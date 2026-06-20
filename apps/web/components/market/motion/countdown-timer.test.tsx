import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CountdownTimer } from './countdown-timer';

describe('CountdownTimer', () => {
  it('renders a soon-urgency countdown with the warning tone', () => {
    const inFiveHours = new Date(Date.now() + 5 * 3_600_000).toISOString();
    render(<CountdownTimer source={inFiveHours} />);
    expect(screen.getByText('5h left')).toHaveClass('text-warning');
  });

  it('renders a multi-day countdown with the muted tone', () => {
    const inThreeDays = new Date(Date.now() + 3 * 86_400_000).toISOString();
    render(<CountdownTimer source={inThreeDays} />);
    expect(screen.getByText('3d left')).toHaveClass('text-muted-foreground');
  });

  it('renders Expired with the destructive tone for a passed deadline', () => {
    const past = new Date(Date.now() - 1_000).toISOString();
    render(<CountdownTimer source={past} />);
    expect(screen.getByText('Expired')).toHaveClass('text-destructive');
  });
});
