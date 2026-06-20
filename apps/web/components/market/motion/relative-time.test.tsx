import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RelativeTime } from './relative-time';

describe('RelativeTime', () => {
  it('renders a relative label in a time element with the absolute value on hover', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
    render(<RelativeTime value={twoHoursAgo} />);

    const el = screen.getByText('2h ago');
    expect(el.tagName).toBe('TIME');
    expect(el).toHaveAttribute('datetime', twoHoursAgo);
    expect(el).toHaveAttribute('title');
  });
});
