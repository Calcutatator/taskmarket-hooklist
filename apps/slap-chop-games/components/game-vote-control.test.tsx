import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const mockedVote = vi.hoisted(() => ({
  fetchState: vi.fn(),
  privy: {
    authenticated: true,
    configured: true,
    getAccessToken: vi.fn(async () => 'access-token'),
    login: vi.fn(),
    ready: true,
  },
  submit: vi.fn(),
}));

vi.mock('@/components/slap-chop-privy-provider', () => ({
  useSlapChopPrivy: () => mockedVote.privy,
}));

vi.mock('@/lib/game-vote-api', () => ({
  fetchGameVoteState: mockedVote.fetchState,
  submitGameVote: mockedVote.submit,
}));

import { GameVoteControl, getOptimisticGameVote, getVoteFailureMessage } from './game-vote-control';

const canonicalVote = {
  downvoteCount: 2,
  gameId: 'orbit-1',
  netVotes: 5,
  selectedVote: null,
  upvoteCount: 7,
} as const;

function renderControl(onVoteChange = vi.fn(), options: { reconcileOnMount?: boolean } = {}) {
  return render(
    <GameVoteControl
      gameId="orbit-1"
      initialDownvoteCount={2}
      initialUpvoteCount={7}
      onVoteChange={onVoteChange}
      reconcileOnMount={options.reconcileOnMount}
      title="Silent Orbit"
    />
  );
}

describe('GameVoteControl', () => {
  it('derives add, replace, and removal state from a canonical selected vote', () => {
    const downvoted = {
      ...canonicalVote,
      downvoteCount: 3,
      netVotes: 4,
      selectedVote: -1 as const,
    };

    expect(getOptimisticGameVote(canonicalVote, 1)).toEqual({
      ...canonicalVote,
      netVotes: 6,
      selectedVote: 1,
      upvoteCount: 8,
    });
    expect(getOptimisticGameVote(downvoted, 1)).toEqual({
      ...canonicalVote,
      netVotes: 6,
      selectedVote: 1,
      upvoteCount: 8,
    });
    expect(
      getOptimisticGameVote({ ...canonicalVote, netVotes: 6, selectedVote: 1, upvoteCount: 8 }, 1)
    ).toEqual(canonicalVote);
  });

  it('opens lightweight sign-in before voting and sends no anonymous request', async () => {
    mockedVote.privy.authenticated = false;
    mockedVote.privy.configured = true;
    mockedVote.privy.ready = true;
    mockedVote.fetchState.mockReset();
    mockedVote.submit.mockReset();
    const user = userEvent.setup();

    renderControl();
    await user.click(screen.getByRole('button', { name: 'Upvote Silent Orbit' }));

    expect(mockedVote.privy.login).toHaveBeenCalledTimes(1);
    expect(mockedVote.fetchState).not.toHaveBeenCalled();
    expect(mockedVote.submit).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Sign in to cast your vote.');
  });

  it('reconciles before optimistic update and rolls back if the server rejects the mutation', async () => {
    mockedVote.privy.authenticated = true;
    mockedVote.privy.configured = true;
    mockedVote.privy.ready = true;
    mockedVote.privy.getAccessToken.mockResolvedValue('access-token');
    mockedVote.fetchState.mockResolvedValue({ ok: true, vote: canonicalVote });
    const onVoteChange = vi.fn();
    let resolveSubmit: ((value: unknown) => void) | undefined;
    mockedVote.submit.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSubmit = resolve;
        })
    );
    const user = userEvent.setup();

    renderControl(onVoteChange, { reconcileOnMount: true });
    await waitFor(() => expect(mockedVote.fetchState).toHaveBeenCalledTimes(1));
    mockedVote.fetchState.mockClear();
    onVoteChange.mockClear();

    await user.click(screen.getByRole('button', { name: 'Upvote Silent Orbit' }));

    await waitFor(() => expect(mockedVote.fetchState).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Upvote Silent Orbit' })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
    );
    expect(mockedVote.submit).toHaveBeenCalledWith('orbit-1', 1, 'access-token');

    resolveSubmit?.({ failure: { kind: 'rate_limited', status: 429 }, ok: false });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Upvote Silent Orbit' })).toHaveAttribute(
        'aria-pressed',
        'false'
      )
    );
    expect(onVoteChange).toHaveBeenLastCalledWith(canonicalVote);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Voting is taking a short break. Please try again later.'
    );
  });

  it('keeps unavailable identity controls non-interactive and names failures clearly', () => {
    mockedVote.privy.authenticated = false;
    mockedVote.privy.configured = false;
    mockedVote.privy.ready = true;

    renderControl();

    expect(screen.getByRole('button', { name: 'Upvote Silent Orbit' })).toBeDisabled();
    expect(getVoteFailureMessage({ kind: 'unauthorized' })).toBe(
      'Your sign-in expired. Sign in again to vote.'
    );
  });
});
