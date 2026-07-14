import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskDropSubscribeForm } from './task-drop-subscribe-form';

const { mutateAsync, statusQuery } = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  statusQuery: vi.fn(),
}));

vi.mock('@/lib/api/client', () => ({
  trpc: {
    taskDrops: {
      status: {
        useQuery: (...args: unknown[]) => statusQuery(...args),
      },
      subscribe: {
        useMutation: () => ({ isPending: false, mutateAsync }),
      },
    },
  },
}));

const DROP_ID = 'drop-1';
const STORAGE_KEY = `taskmarket:task-drop-subscription:${DROP_ID}`;

describe('TaskDropSubscribeForm', () => {
  beforeEach(() => {
    localStorage.clear();
    mutateAsync.mockReset();
    statusQuery.mockReset();
    statusQuery.mockReturnValue({ data: undefined, isLoading: false });
  });

  it('resolves an already-active subscription from saved browser state', async () => {
    localStorage.setItem(STORAGE_KEY, 'alice@example.com');
    statusQuery.mockImplementation((input: { email?: string; taskDropId: string }) => ({
      data: input.email ? { subscribed: true, taskDropId: input.taskDropId } : undefined,
      isLoading: false,
    }));

    render(<TaskDropSubscribeForm taskDropId={DROP_ID} />);

    expect(await screen.findByText(/already following this drop/i)).toBeVisible();
    expect(statusQuery).toHaveBeenCalledWith(
      { email: 'alice@example.com', taskDropId: DROP_ID },
      expect.objectContaining({ enabled: true })
    );
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('persists the normalized email after subscribing', async () => {
    const user = userEvent.setup();
    mutateAsync.mockResolvedValue({
      alreadySubscribed: false,
      email: 'alice@example.com',
      subscribed: true,
      taskDropId: DROP_ID,
    });
    render(<TaskDropSubscribeForm taskDropId={DROP_ID} />);

    await user.type(screen.getByLabelText(/email/i), '  ALICE@Example.COM ');
    await user.click(screen.getByRole('button', { name: /^subscribe$/i }));

    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).toBe('alice@example.com'));
  });
});
