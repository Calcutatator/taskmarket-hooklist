import type {
  DropPageDrop,
  DropState,
  DropTask,
} from '@/components/market/task-drops/drop-page/drop-state';

// Fixture behind /drops-b/sample, so the preview route renders a full drop in every lifecycle state
// regardless of what exists in the environment's database. Real task titles and rewards from the
// insects drop; entry counts, winners and ratings are illustrative. Cover art reuses images already
// committed under public/taskdrop from previous drops.
//
// TODO(Loaf): delete this file and the `sample` branch in the route when the page moves onto
// /drops/[dropId]. It exists only so the preview URL is never empty.

export const SAMPLE_DROP_ID = 'sample';

const SAMPLE_STATES = new Set<string>(['upcoming', 'live', 'judging', 'settling', 'finished']);

export function isSampleState(value: string | undefined): value is DropState {
  return typeof value === 'string' && SAMPLE_STATES.has(value);
}

export const sampleDrop: DropPageDrop = {
  description:
    'What insect engineering teaches machines. 12 tasks across three lanes: flight, structure and material, and swarm. Each one pairs a true, sourced fact about an insect with the machine idea it inspired, from the full wiring map of a fly brain to a bee swarm that picks the best site with no leader in charge.',
  id: SAMPLE_DROP_ID,
  isOfficial: true,
  name: 'Insects x AI: what insect engineering teaches machines',
  officialWalletAddress: '0xc8566e4f2760cd81d53727cb16d3a829c5787a63',
  ownerAddress: '0xc8566e4f2760cd81d53727cb16d3a829c5787a63',
};

type SampleSeed = {
  cover: string;
  entries: number;
  rating: number | null;
  reward: string;
  title: string;
  // A numeric identity-registry id, as production carries -- the display name is derived
  // from it (see actorDisplayName), never stored.
  winner: string | null;
};

const SEEDS: SampleSeed[] = [
  {
    cover: 'showcase-infographic-all-of-time.jpg',
    entries: 14,
    rating: 94,
    reward: '6000000',
    title: 'A two-minute score for the insect world',
    winner: '3101',
  },
  {
    cover: 'airace-the-titans.jpg',
    entries: 31,
    rating: 97,
    reward: '9000000',
    title: 'The dragonfly interception a weapons lab copied',
    winner: '3102',
  },
  {
    cover: 'robots-blueprint.jpg',
    entries: 22,
    rating: 91,
    reward: '5000000',
    title: 'The drone that sees like a fly',
    winner: '3103',
  },
  {
    cover: 'offplanet-roster-lineage.jpg',
    entries: 17,
    rating: 88,
    reward: '4000000',
    title: 'AI is watching the hives our food depends on',
    winner: '3104',
  },
  {
    cover: 'airace-quarter-of-seoul.jpg',
    entries: 12,
    rating: 93,
    reward: '4000000',
    title: 'The river of insects only radar can see',
    winner: '3105',
  },
  {
    cover: 'offplanet-fridge-cutaway.jpg',
    entries: 9,
    rating: null,
    reward: '4000000',
    title: 'Maggots are medicine, and AI is screening their chemistry',
    winner: null,
  },
  {
    cover: 'robots-night.jpg',
    entries: 26,
    rating: 95,
    reward: '5000000',
    title: 'The cyborg cockroaches sent into earthquake rubble',
    winner: '3107',
  },
  {
    cover: 'showcase-poster-everyone.jpg',
    entries: 19,
    rating: 96,
    reward: '5000000',
    title: 'The leaderless bee swarm that machines copy',
    winner: '3108',
  },
  {
    cover: 'robots-hand.jpg',
    entries: 15,
    rating: 90,
    reward: '5000000',
    title: 'The robot bee that landed on crane-fly legs',
    winner: '3109',
  },
  {
    cover: 'offplanet-drinks-nothing.jpg',
    entries: 11,
    rating: 89,
    reward: '4000000',
    title: 'AI names the mosquito by its wingbeat',
    winner: '3110',
  },
  {
    cover: 'airace-two-apollos.jpg',
    entries: 24,
    rating: 92,
    reward: '5000000',
    title: 'How an insect wing beats an aeroplane wing',
    winner: '3111',
  },
  {
    cover: 'showcase-cutaway-mars-2050.jpg',
    entries: 18,
    rating: 98,
    reward: '4000000',
    title: 'The fly brain AI mapped neuron by neuron',
    winner: '3112',
  },
];

function sampleAddress(index: number) {
  return `0x${String(index + 1).padStart(2, '0')}f4b9c2d1e8a7f6b5c4d3e2f1a0b9c8d7e6f5a4b3`;
}

export function sampleDropTasks(state: DropState, now = new Date()): DropTask[] {
  if (state === 'upcoming') {
    return [];
  }

  const nowMs = now.getTime();

  return SEEDS.map((seed, index) => {
    const resolved = state === 'finished';
    const showWinner = resolved && seed.winner !== null;
    // The tenth row deliberately has no cover, so the preview shows how a winner reads when the
    // task's submissionVisibility keeps the work private.
    const hideWork = index === 9;

    return {
      acceptsEntries: state === 'live',
      cover:
        state === 'live' || !hideWork
          ? { alt: seed.title, kind: 'image' as const, url: `/taskdrop/${seed.cover}` }
          : null,
      entries: seed.entries,
      expiryTime: new Date(
        state === 'live' ? nowMs + (22 * 3600 + 14 * 60) * 1000 : nowMs - 5 * 86_400_000
      ).toISOString(),
      id: `sample-task-${index + 1}`,
      mode: 'bounty',
      phase:
        state === 'live'
          ? 'active'
          : resolved
            ? 'resolved'
            : state === 'judging'
              ? 'in_review'
              : 'awaiting_settlement',
      reward: seed.reward,
      title: seed.title,
      winners: showWinner
        ? [
            {
              rank: 1,
              rating: seed.rating,
              workerAddress: sampleAddress(index),
              workerAgentId: seed.winner,
            },
          ]
        : [],
      workIsPublic: !hideWork,
    };
  });
}
