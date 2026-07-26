import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DropAlertsInlineForm } from './drop-alerts-inline-form';

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

describe('DropAlertsInlineForm', () => {
  beforeEach(() => {
    localStorage.clear();
    mutateAsync.mockReset();
    statusQuery.mockReset();
    statusQuery.mockReturnValue({ data: undefined });
  });

  it('subscribes through the official subscription API and persists the email', async () => {
    const user = userEvent.setup();
    mutateAsync.mockResolvedValue({
      alreadySubscribed: false,
      email: 'alice@example.com',
      scope: 'official',
      subscribed: true,
    });
    render(<DropAlertsInlineForm />);

    await user.type(screen.getByLabelText(/email address/i), 'alice@example.com');
    await user.click(screen.getByRole('button', { name: 'SIGN ME UP' }));

    expect(await screen.findByText(/you.re subscribed/i)).toBeVisible();
    expect(mutateAsync).toHaveBeenCalledWith({
      email: 'alice@example.com',
      source: 'taskdrop_landing',
    });
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
    render(<DropAlertsInlineForm />);

    await user.type(screen.getByLabelText(/email address/i), 'alice@example.com');
    await user.click(screen.getByRole('button', { name: 'SIGN ME UP' }));

    expect(await screen.findByText(/you.re subscribed/i)).toBeVisible();
  });

  it('keeps the form in place and reports a real API failure', async () => {
    const user = userEvent.setup();
    mutateAsync.mockRejectedValue(new Error('Service unavailable'));
    render(<DropAlertsInlineForm />);

    await user.type(screen.getByLabelText(/email address/i), 'alice@example.com');
    await user.click(screen.getByRole('button', { name: 'SIGN ME UP' }));

    expect(await screen.findByText('Service unavailable')).toBeVisible();
    expect(screen.getByLabelText(/email address/i)).toBeVisible();
    expect(screen.getByLabelText(/email address/i)).toHaveAttribute('aria-invalid', 'true');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('falls back to a generic message when the failure carries no message', async () => {
    const user = userEvent.setup();
    mutateAsync.mockRejectedValue('offline');
    render(<DropAlertsInlineForm />);

    await user.type(screen.getByLabelText(/email address/i), 'alice@example.com');
    await user.click(screen.getByRole('button', { name: 'SIGN ME UP' }));

    expect(await screen.findByText('Could not subscribe. Please try again.')).toBeVisible();
  });

  it('clears the error once the visitor edits the address again', async () => {
    const user = userEvent.setup();
    mutateAsync.mockRejectedValue(new Error('Service unavailable'));
    render(<DropAlertsInlineForm />);

    await user.type(screen.getByLabelText(/email address/i), 'alice@example.com');
    await user.click(screen.getByRole('button', { name: 'SIGN ME UP' }));
    expect(await screen.findByText('Service unavailable')).toBeVisible();

    await user.type(screen.getByLabelText(/email address/i), 'x');

    expect(screen.queryByText('Service unavailable')).not.toBeInTheDocument();
  });

  it('restores a persisted active official subscription', async () => {
    localStorage.setItem(STORAGE_KEY, 'alice@example.com');
    statusQuery.mockImplementation((input: { email: string }) => ({
      data: input.email ? { scope: 'official', subscribed: true } : undefined,
    }));

    render(<DropAlertsInlineForm />);

    await waitFor(() => expect(screen.getByText(/you.re subscribed/i)).toBeVisible());
  });

  it('drops a persisted email the API no longer reports as subscribed', async () => {
    localStorage.setItem(STORAGE_KEY, 'alice@example.com');
    statusQuery.mockImplementation((input: { email: string }) => ({
      data: input.email ? { scope: 'official', subscribed: false } : undefined,
    }));

    render(<DropAlertsInlineForm />);

    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).toBeNull());
    expect(screen.queryByText(/you.re subscribed/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toBeVisible();
  });
});
