import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskDropSubscribeForm } from './task-drop-subscribe-form';

const { mutateAsync, officialMutateAsync, officialStatusQuery, statusQuery } = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  officialMutateAsync: vi.fn(),
  officialStatusQuery: vi.fn(),
  statusQuery: vi.fn(),
}));

vi.mock('@/lib/api/client', () => ({
  trpc: {
    taskDrops: {
      officialStatus: {
        useQuery: (...args: unknown[]) => officialStatusQuery(...args),
      },
      status: {
        useQuery: (...args: unknown[]) => statusQuery(...args),
      },
      subscribe: {
        useMutation: () => ({ isPending: false, mutateAsync }),
      },
      subscribeOfficial: {
        useMutation: () => ({ isPending: false, mutateAsync: officialMutateAsync }),
      },
    },
  },
}));

const DROP_ID = 'drop-1';
const STORAGE_KEY = `taskmarket:task-drop-subscription:${DROP_ID}`;
const OFFICIAL_STORAGE_KEY = 'taskmarket:official-task-drop-subscription';

describe('TaskDropSubscribeForm', () => {
  beforeEach(() => {
    localStorage.clear();
    mutateAsync.mockReset();
    officialMutateAsync.mockReset();
    officialStatusQuery.mockReset();
    statusQuery.mockReset();
    officialStatusQuery.mockReturnValue({ data: undefined, isLoading: false });
    statusQuery.mockReturnValue({ data: undefined, isLoading: false });
  });

  it('resolves an already-active exact subscription from saved browser state', async () => {
    localStorage.setItem(STORAGE_KEY, 'alice@example.com');
    statusQuery.mockImplementation((input: { email?: string; taskDropId: string }) => ({
      data: input.email
        ? { scope: 'drop', subscribed: true, taskDropId: input.taskDropId }
        : undefined,
      isLoading: false,
    }));

    render(<TaskDropSubscribeForm isOfficial={false} taskDropId={DROP_ID} />);

    expect(await screen.findByText(/already following this drop/i)).toBeVisible();
    expect(statusQuery).toHaveBeenCalledWith(
      { email: 'alice@example.com', taskDropId: DROP_ID },
      expect.objectContaining({ enabled: true })
    );
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('persists the normalized email after an exact subscription', async () => {
    const user = userEvent.setup();
    mutateAsync.mockResolvedValue({
      alreadySubscribed: false,
      email: 'alice@example.com',
      scope: 'drop',
      subscribed: true,
      taskDropId: DROP_ID,
    });
    render(<TaskDropSubscribeForm isOfficial={false} taskDropId={DROP_ID} />);

    await user.type(screen.getByLabelText(/email/i), '  ALICE@Example.COM ');
    await user.click(screen.getByRole('button', { name: /^subscribe$/i }));

    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).toBe('alice@example.com'));
  });

  it('uses umbrella consent and a global storage key for an official drop', async () => {
    const user = userEvent.setup();
    officialMutateAsync.mockResolvedValue({
      alreadySubscribed: false,
      email: 'alice@example.com',
      scope: 'official',
      subscribed: true,
    });
    render(<TaskDropSubscribeForm isOfficial taskDropId={DROP_ID} />);

    await user.type(screen.getByLabelText(/email/i), 'alice@example.com');
    await user.click(screen.getByRole('button', { name: /get official drops/i }));

    await waitFor(() =>
      expect(localStorage.getItem(OFFICIAL_STORAGE_KEY)).toBe('alice@example.com')
    );
    expect(officialMutateAsync).toHaveBeenCalledWith({
      email: 'alice@example.com',
      source: 'official_drop_page',
    });
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('shows grandfathered exact consent as an upgrade state on an official drop', async () => {
    localStorage.setItem(STORAGE_KEY, 'alice@example.com');
    officialStatusQuery.mockReturnValue({ data: { scope: null, subscribed: false } });
    statusQuery.mockReturnValue({
      data: { scope: 'drop', subscribed: true, taskDropId: DROP_ID },
    });

    render(<TaskDropSubscribeForm isOfficial taskDropId={DROP_ID} />);

    expect(await screen.findByText(/follows only this drop/i)).toBeVisible();
    expect(screen.getByLabelText(/email/i)).toHaveValue('alice@example.com');
  });

  it('reports official subscription failures without claiming success', async () => {
    const user = userEvent.setup();
    officialMutateAsync.mockRejectedValue(new Error('Service unavailable'));
    render(<TaskDropSubscribeForm isOfficial taskDropId={DROP_ID} />);

    await user.type(screen.getByLabelText(/email/i), 'alice@example.com');
    await user.click(screen.getByRole('button', { name: /get official drops/i }));

    expect(await screen.findByText('Service unavailable')).toBeVisible();
    expect(localStorage.getItem(OFFICIAL_STORAGE_KEY)).toBeNull();
  });
});
