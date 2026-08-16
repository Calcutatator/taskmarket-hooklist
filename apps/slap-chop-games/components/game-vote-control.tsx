'use client';

import type { GameVoteResponse, GameVoteValue } from '@taskmarket/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useSlapChopPrivy } from '@/components/slap-chop-privy-provider';
import { fetchGameVoteState, submitGameVote, type GameVoteFailure } from '@/lib/game-vote-api';

type GameVoteControlProps = {
  gameId: string;
  initialDownvoteCount: number;
  initialUpvoteCount: number;
  onVoteChange?: (vote: GameVoteResponse) => void;
  reconcileOnMount?: boolean;
  title: string;
};

export type GameVoteButtonsProps = {
  disabled?: boolean;
  onSelect: (value: GameVoteValue) => void;
  pending?: boolean;
  selectedVote: GameVoteValue | null;
  title: string;
};

function createVoteSnapshot({
  gameId,
  initialDownvoteCount,
  initialUpvoteCount,
}: Pick<
  GameVoteControlProps,
  'gameId' | 'initialDownvoteCount' | 'initialUpvoteCount'
>): GameVoteResponse {
  return {
    downvoteCount: initialDownvoteCount,
    gameId,
    netVotes: initialUpvoteCount - initialDownvoteCount,
    selectedVote: null,
    upvoteCount: initialUpvoteCount,
  };
}

// Implements: ADR-0089. The server remains authoritative; this only derives the short-lived
// optimistic state that is reconciled from the authenticated vote read before every mutation.
export function getOptimisticGameVote(
  canonicalVote: GameVoteResponse,
  selectedValue: GameVoteValue
): GameVoteResponse {
  const nextSelectedVote = canonicalVote.selectedVote === selectedValue ? null : selectedValue;
  const upvoteCount =
    canonicalVote.upvoteCount +
    Number(nextSelectedVote === 1) -
    Number(canonicalVote.selectedVote === 1);
  const downvoteCount =
    canonicalVote.downvoteCount +
    Number(nextSelectedVote === -1) -
    Number(canonicalVote.selectedVote === -1);

  return {
    ...canonicalVote,
    downvoteCount,
    netVotes: upvoteCount - downvoteCount,
    selectedVote: nextSelectedVote,
    upvoteCount,
  };
}

export function getVoteFailureMessage(failure: GameVoteFailure): string {
  if (failure.kind === 'unauthorized') {
    return 'Your sign-in expired. Sign in again to vote.';
  }

  if (failure.kind === 'rate_limited') {
    return 'Voting is taking a short break. Please try again later.';
  }

  if (failure.kind === 'not_found') {
    return 'This game is no longer available for voting.';
  }

  if (failure.kind === 'invalid_response') {
    return 'The vote result was unreadable. Your vote was not changed.';
  }

  return 'Voting is unavailable right now. Your vote was not changed.';
}

export function GameVoteButtons({
  disabled = false,
  onSelect,
  pending = false,
  selectedVote,
  title,
}: Readonly<GameVoteButtonsProps>) {
  const upvoteSelected = selectedVote === 1;
  const downvoteSelected = selectedVote === -1;

  return (
    <div aria-label={`Vote on ${title}`} className="flex items-center" role="group">
      <button
        aria-label={`Upvote ${title}`}
        aria-pressed={upvoteSelected}
        className={`min-h-9 min-w-9 border border-catalog-border px-2 font-mono text-sm font-semibold focus-visible:relative focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-catalog-focus ${
          upvoteSelected
            ? 'bg-catalog-ink text-catalog-canvas'
            : 'bg-catalog-surface text-catalog-ink hover:bg-catalog-canvas'
        } disabled:cursor-wait disabled:text-catalog-muted`}
        disabled={disabled || pending}
        onClick={() => onSelect(1)}
        type="button"
      >
        +
      </button>
      <button
        aria-label={`Downvote ${title}`}
        aria-pressed={downvoteSelected}
        className={`-ml-px min-h-9 min-w-9 border border-catalog-border px-2 font-mono text-sm font-semibold focus-visible:relative focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-catalog-focus ${
          downvoteSelected
            ? 'bg-catalog-ink text-catalog-canvas'
            : 'bg-catalog-surface text-catalog-ink hover:bg-catalog-canvas'
        } disabled:cursor-wait disabled:text-catalog-muted`}
        disabled={disabled || pending}
        onClick={() => onSelect(-1)}
        type="button"
      >
        −
      </button>
    </div>
  );
}

export function GameVoteControl({
  gameId,
  initialDownvoteCount,
  initialUpvoteCount,
  onVoteChange,
  reconcileOnMount = false,
  title,
}: Readonly<GameVoteControlProps>) {
  const privy = useSlapChopPrivy();
  const [snapshot, setSnapshot] = useState(() =>
    createVoteSnapshot({ gameId, initialDownvoteCount, initialUpvoteCount })
  );
  const [pending, setPending] = useState(false);
  const [queuedVote, setQueuedVote] = useState<GameVoteValue | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const requestSequence = useRef(0);
  const priorGameId = useRef(gameId);
  const onVoteChangeRef = useRef(onVoteChange);
  const voteInFlight = useRef(false);
  const voteOperationId = useRef(0);

  useEffect(() => {
    onVoteChangeRef.current = onVoteChange;
  }, [onVoteChange]);

  const acceptCanonicalVote = useCallback((vote: GameVoteResponse) => {
    setSnapshot(vote);
    onVoteChangeRef.current?.(vote);
  }, []);

  useEffect(() => {
    if (priorGameId.current === gameId) {
      return;
    }

    priorGameId.current = gameId;
    requestSequence.current += 1;
    voteOperationId.current += 1;
    voteInFlight.current = false;
    setPending(false);
    setQueuedVote(null);
    setStatusMessage('');
    setSnapshot(createVoteSnapshot({ gameId, initialDownvoteCount, initialUpvoteCount }));
  }, [gameId, initialDownvoteCount, initialUpvoteCount]);

  const reconcileVote = useCallback(async (): Promise<GameVoteResponse | null> => {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;

    try {
      const accessToken = await privy.getAccessToken();
      const result = await fetchGameVoteState(gameId, accessToken);

      if (requestSequence.current !== sequence) {
        return null;
      }

      if (!result.ok) {
        setStatusMessage(getVoteFailureMessage(result.failure));
        return null;
      }

      acceptCanonicalVote(result.vote);
      return result.vote;
    } catch {
      if (requestSequence.current === sequence) {
        setStatusMessage('Voting is unavailable right now. Your vote was not changed.');
      }
      return null;
    }
  }, [acceptCanonicalVote, gameId, privy.getAccessToken]);

  const performVote = useCallback(
    async (value: GameVoteValue) => {
      if (pending || voteInFlight.current) {
        return;
      }

      const operationId = voteOperationId.current + 1;
      voteOperationId.current = operationId;
      voteInFlight.current = true;
      setPending(true);
      setStatusMessage('');
      const canonicalVote = await reconcileVote();

      if (!canonicalVote) {
        if (voteOperationId.current === operationId) {
          voteInFlight.current = false;
          setPending(false);
        }
        return;
      }

      const mutationSequence = requestSequence.current + 1;
      requestSequence.current = mutationSequence;
      const optimisticVote = getOptimisticGameVote(canonicalVote, value);
      acceptCanonicalVote(optimisticVote);

      try {
        const accessToken = await privy.getAccessToken();
        const result = await submitGameVote(gameId, value, accessToken);

        if (requestSequence.current !== mutationSequence) {
          return;
        }

        if (result.ok) {
          acceptCanonicalVote(result.vote);
          setStatusMessage('Vote saved.');
        } else {
          acceptCanonicalVote(canonicalVote);
          setStatusMessage(getVoteFailureMessage(result.failure));
        }
      } catch {
        if (requestSequence.current === mutationSequence) {
          acceptCanonicalVote(canonicalVote);
          setStatusMessage('Voting is unavailable right now. Your vote was not changed.');
        }
      } finally {
        if (voteOperationId.current === operationId) {
          voteInFlight.current = false;
        }
        if (requestSequence.current === mutationSequence) {
          setPending(false);
        }
      }
    },
    [acceptCanonicalVote, gameId, pending, privy.getAccessToken, reconcileVote]
  );

  useEffect(() => {
    if (
      !reconcileOnMount ||
      !privy.authenticated ||
      !privy.ready ||
      voteInFlight.current ||
      queuedVote !== null
    ) {
      return;
    }

    void reconcileVote();
  }, [privy.authenticated, privy.ready, queuedVote, reconcileOnMount, reconcileVote]);

  useEffect(() => {
    if (!privy.authenticated || !privy.ready || queuedVote === null) {
      return;
    }

    setQueuedVote(null);
    void performVote(queuedVote);
  }, [performVote, privy.authenticated, privy.ready, queuedVote]);

  function handleSelect(value: GameVoteValue) {
    if (!privy.configured) {
      setStatusMessage('Voting is not configured for this catalog.');
      return;
    }

    if (!privy.ready) {
      setStatusMessage('Preparing sign-in.');
      return;
    }

    if (!privy.authenticated) {
      setQueuedVote(value);
      setStatusMessage('Sign in to cast your vote.');
      privy.login();
      return;
    }

    void performVote(value);
  }

  const disabled = !privy.configured || !privy.ready;

  return (
    <div className="flex flex-col items-end gap-1">
      <GameVoteButtons
        disabled={disabled}
        onSelect={handleSelect}
        pending={pending}
        selectedVote={snapshot.selectedVote}
        title={title}
      />
      <span aria-live="polite" className="sr-only" role="status">
        {statusMessage}
      </span>
    </div>
  );
}
