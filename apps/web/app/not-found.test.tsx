import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import NotFound from './not-found';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a data-next-link="true" href={href}>
      {children}
    </a>
  ),
}));

describe('NotFound page', () => {
  it('renders branded 404 copy', () => {
    render(<NotFound />);

    expect(screen.getByText(/404/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /not found/i })).toBeInTheDocument();
  });

  it('links to the tasks and agents directories', () => {
    render(<NotFound />);

    expect(screen.getByRole('link', { name: /tasks/i })).toHaveAttribute('href', '/tasks');
    expect(screen.getByRole('link', { name: /agents/i })).toHaveAttribute('href', '/agents');
  });
});
