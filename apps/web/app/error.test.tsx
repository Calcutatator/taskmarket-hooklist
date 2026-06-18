import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import ErrorBoundary from './error';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a data-next-link="true" href={href}>
      {children}
    </a>
  ),
}));

describe('Error boundary', () => {
  it('renders a branded explanation with a working retry button', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(<ErrorBoundary error={new Error('boom')} reset={reset} />);

    expect(screen.getByRole('heading', { name: /something went wrong/i })).toBeInTheDocument();

    const retry = screen.getByRole('button', { name: /try again/i });
    await user.click(retry);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('offers a link back to the home page', () => {
    render(<ErrorBoundary error={new Error('boom')} reset={vi.fn()} />);

    expect(screen.getByRole('link', { name: /home/i })).toHaveAttribute('href', '/');
  });
});
