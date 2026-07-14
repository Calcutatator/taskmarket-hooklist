import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FirstRunChecklist } from './first-run-checklist';

const { inboxQuery, statsQuery, walletState } = vi.hoisted(() => ({
  inboxQuery: vi.fn(),
  statsQuery: vi.fn(),
  walletState: {
    address: undefined as string | undefined,
    isConnected: false,
  },
}));

vi.mock('wagmi', () => ({
  useAccount: () => walletState,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/api/client', () => ({
  trpc: {
    agents: {
      inbox: {
        useQuery: (...args: unknown[]) => inboxQuery(...args),
      },
      stats: {
        useQuery: (...args: unknown[]) => statsQuery(...args),
      },
    },
  },
}));

describe('FirstRunChecklist', () => {
  beforeEach(() => {
    localStorage.clear();
    walletState.address = undefined;
    walletState.isConnected = false;
    inboxQuery.mockReturnValue({ data: null });
    statsQuery.mockReturnValue({ data: null });
  });

  it('renders a compact sidebar stepper with points and the current CTA', () => {
    render(<FirstRunChecklist />);

    expect(screen.getByRole('region', { name: /first run onboarding/i })).toBeVisible();
    expect(screen.getByRole('heading', { name: /first run/i })).toBeVisible();
    expect(screen.getAllByText(/0\/100/).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /post a task/i })).toHaveAttribute(
      'href',
      '/dashboard/tasks/new'
    );
    expect(screen.getByText(/respond to a task/i)).toBeVisible();
    expect(screen.queryByLabelText(/email for task drops/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /minimize first-run checklist/i })).toBeVisible();
    expect(screen.getByRole('button', { name: /dismiss first-run checklist/i })).toBeVisible();
  });

  it('derives posting and responding completion from wallet activity', async () => {
    walletState.address = '0x1111111111111111111111111111111111111111';
    walletState.isConnected = true;
    inboxQuery.mockReturnValue({
      data: {
        asRequester: [{ id: 'task-posted' }],
        asWorker: [{ id: 'task-answered' }],
      },
    });

    render(<FirstRunChecklist />);

    expect((await screen.findAllByText(/100\/100/)).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: /browse tasks/i })).not.toBeInTheDocument();
  });

  it('minimizes and restores the checklist', async () => {
    const user = userEvent.setup();
    render(<FirstRunChecklist />);

    await user.click(screen.getByRole('button', { name: /minimize first-run checklist/i }));

    expect(screen.queryByRole('link', { name: /post a task/i })).not.toBeInTheDocument();
    const restore = screen.getByRole('button', { name: /expand first-run checklist/i });
    expect(restore).toBeVisible();

    await user.click(restore);

    expect(screen.getByRole('link', { name: /post a task/i })).toBeVisible();
  });

  it('dismisses the checklist for the current wallet', async () => {
    const user = userEvent.setup();
    render(<FirstRunChecklist />);

    await user.click(screen.getByRole('button', { name: /dismiss first-run checklist/i }));

    expect(screen.queryByRole('region', { name: /first run onboarding/i })).not.toBeInTheDocument();
  });
});
