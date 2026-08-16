import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { GameVoteButtons } from '@/components/game-vote-control';

const meta = {
  args: {
    onSelect: fn(),
    selectedVote: null,
    title: 'Silent Orbit',
  },
  component: GameVoteButtons,
  parameters: {
    a11y: {
      test: 'error',
    },
  },
  tags: ['autodocs'],
  title: 'Catalog/Game vote control',
} satisfies Meta<typeof GameVoteButtons>;

export default meta;

type Story = StoryObj<typeof meta>;

// storybook-coverage: components/game-vote-control.tsx
export const Neutral: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole('button', { name: 'Upvote Silent Orbit' }));

    await expect(args.onSelect).toHaveBeenCalledWith(1);
  },
};

export const Upvoted: Story = {
  args: {
    selectedVote: 1,
  },
};

export const Downvoted: Story = {
  args: {
    selectedVote: -1,
  },
};

export const Saving: Story = {
  args: {
    pending: true,
  },
};

export const IdentityUnavailable: Story = {
  args: {
    disabled: true,
  },
};
