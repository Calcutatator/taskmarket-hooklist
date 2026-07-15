import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DropAlertsForm } from './drop-alerts-form';

const { mutateAsync, statusQuery } = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  statusQuery: vi.fn(),
}));

vi.mock('@/lib/api/client', () => ({
  trpc: {
    taskDrops: {
      officialStatus: { useQuery: (...args: unknown[]) => statusQuery(...args) },
      subscribeOfficial: {
        useMutation: () => ({ isPending: false, mutateAsync }),
      },
    },
  },
}));

const STORAGE_KEY = 'taskmarket:official-task-drop-subscription';

describe('DropAlertsForm', () => {
  beforeEach(() => {
    localStorage.clear();
    mutateAsync.mockReset();
    statusQuery.mockReset();
    statusQuery.mockReturnValue({ data: undefined });
  });

  it('shows success only after the official subscription API succeeds', async () => {
    const user = userEvent.setup();
    mutateAsync.mockResolvedValue({
      alreadySubscribed: false,
      email: 'alice@example.com',
      scope: 'official',
      subscribed: true,
    });
    render(<DropAlertsForm />);

    await user.type(screen.getByLabelText(/email address/i), 'alice@example.com');
    await user.click(screen.getByRole('button', { name: /sign me up/i }));

    expect(await screen.findByText(/you.re subscribed/i)).toBeVisible();
    expect(localStorage.getItem(STORAGE_KEY)).toBe('alice@example.com');
  });

  it('treats an idempotent duplicate as success', async () => {
    const user = userEvent.setup();
    mutateAsync.mockResolvedValue({
      alreadySubscribed: true,
      email: 'alice@example.com',
      scope: 'official',
      subscribed: true,
    });
    render(<DropAlertsForm />);

    await user.type(screen.getByLabelText(/email address/i), 'alice@example.com');
    await user.click(screen.getByRole('button', { name: /sign me up/i }));

    expect(await screen.findByText(/you.re subscribed/i)).toBeVisible();
  });

  it('keeps the form open and reports a real API failure', async () => {
    const user = userEvent.setup();
    mutateAsync.mockRejectedValue(new Error('Service unavailable'));
    render(<DropAlertsForm />);

    await user.type(screen.getByLabelText(/email address/i), 'alice@example.com');
    await user.click(screen.getByRole('button', { name: /sign me up/i }));

    expect(await screen.findByText('Service unavailable')).toBeVisible();
    expect(screen.getByLabelText(/email address/i)).toBeVisible();
  });

  it('restores a persisted active official subscription', async () => {
    localStorage.setItem(STORAGE_KEY, 'alice@example.com');
    statusQuery.mockImplementation((input: { email: string }) => ({
      data: input.email ? { scope: 'official', subscribed: true } : undefined,
    }));

    render(<DropAlertsForm />);

    await waitFor(() => expect(screen.getByText(/you.re subscribed/i)).toBeVisible());
  });
});
