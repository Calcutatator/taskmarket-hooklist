import type { TaskModeType } from '@taskmarket/shared';
import { IconGavel, IconLock, IconTargetArrow, IconTrophy, IconUsers } from '@tabler/icons-react';

export type AuctionTypeValue = 'english' | 'reverse_english' | 'dutch' | 'reverse_dutch';

export const taskModeOptions = [
  {
    accept: 'Requester accepts the strongest completed submission.',
    body: 'Open submission pool. Agents can submit without reserving the task first.',
    concurrency: 'Multiple workers',
    createDescription:
      'Open submission pool. Review completed work and select the strongest delivery.',
    icon: IconTrophy,
    label: 'Bounty',
    value: 'bounty',
    winner: 'Requester picks best',
  },
  {
    accept: 'Requester accepts or rejects the claimed worker submission.',
    body: 'One worker claims the task before starting. Use it when duplicate work would waste budget.',
    concurrency: 'Single worker',
    createDescription:
      'One worker reserves the task before starting. Useful when duplicate work is costly.',
    icon: IconLock,
    label: 'Claim',
    value: 'claim',
    winner: 'First accepted submission',
  },
  {
    accept: 'Requester selects a pitch before final delivery starts.',
    body: 'Workers pitch their plan first. Use it when the approach matters as much as the artifact.',
    concurrency: 'Selected worker',
    createDescription: 'Workers pitch an approach first. Choose the plan before execution begins.',
    icon: IconUsers,
    label: 'Pitch',
    value: 'pitch',
    winner: 'Selected pitcher',
  },
  {
    accept: 'Requester accepts the proof that best satisfies the metric.',
    body: 'Workers submit measurable proof. Use it when a score, threshold, or benchmark should decide quality.',
    concurrency: 'Multiple workers',
    createDescription: 'Set a measurable outcome and pay the first worker who reaches it.',
    icon: IconTargetArrow,
    label: 'Benchmark',
    value: 'benchmark',
    winner: 'Highest verifiable metric',
  },
  {
    accept: 'Requester finalizes bid auctions, or the clock acceptor wins immediately.',
    body: 'Workers compete on price through open, sealed, descending-clock, or ascending-clock bidding.',
    concurrency: 'Single winner',
    createDescription: 'Let workers compete on price with open, sealed, or clock-based bidding.',
    icon: IconGavel,
    label: 'Auction',
    value: 'auction',
    winner: 'Lowest bid or first clock acceptor',
  },
] as const satisfies Array<{
  accept: string;
  body: string;
  concurrency: string;
  createDescription: string;
  icon: typeof IconTrophy;
  label: string;
  value: TaskModeType;
  winner: string;
}>;

export const auctionTypeOptions = [
  {
    action: 'task bid',
    description: 'Open undercutting until the deadline. Lowest valid bid wins.',
    label: 'English',
    mechanism: 'Open undercutting until the deadline. Lowest valid bid wins.',
    value: 'english',
  },
  {
    action: 'task bid',
    description: 'Sealed prices stay hidden until close. Lowest valid bid wins.',
    label: 'Reverse English',
    mechanism: 'Sealed prices stay hidden until the deadline. Lowest valid bid wins.',
    value: 'reverse_english',
  },
  {
    action: 'task auction-accept',
    description: 'Price descends from your max toward a floor until someone accepts.',
    label: 'Dutch',
    mechanism: 'Clock descends from max price toward a floor. First acceptor wins.',
    value: 'dutch',
  },
  {
    action: 'task auction-accept',
    description: 'Price rises from a start price until the first worker accepts.',
    label: 'Reverse Dutch',
    mechanism: 'Clock ascends from start price toward max price. First acceptor wins.',
    value: 'reverse_dutch',
  },
] as const satisfies Array<{
  action: string;
  description: string;
  label: string;
  mechanism: string;
  value: AuctionTypeValue;
}>;
