import { GamePlayer } from '@/components/game-player';
import { GameVoteControl } from '@/components/game-vote-control';
import { getEnvironment } from '@/lib/environment';
import { fetchGameDetail } from '@/lib/game-detail-api';

// A delivery URL is intentionally short-lived, so this route must always request a current
// catalog record rather than cache a signed artifact URL in the application layer.
export const dynamic = 'force-dynamic';

// Implements: ADR-0087. The route resolves a catalog pin; it never asks for a latest task artifact.
export default async function GamePage({
  params,
}: Readonly<{
  params: Promise<{ slug: string }>;
}>) {
  const { slug } = await params;
  const [result, environment] = await Promise.all([fetchGameDetail(slug), getEnvironment()]);
  const votingEnabled = environment.SLAP_CHOP_DATA_MODE !== 'live-readonly';

  return (
    <GamePlayer
      controls={
        result.ok && votingEnabled ? (
          <GameVoteControl
            gameId={result.game.id}
            initialDownvoteCount={result.game.downvoteCount}
            initialUpvoteCount={result.game.upvoteCount}
            reconcileOnMount
            title={result.game.title}
          />
        ) : undefined
      }
      initialFailure={result.ok ? undefined : result.failure}
      initialGame={result.ok ? result.game : null}
      slug={slug}
    />
  );
}
