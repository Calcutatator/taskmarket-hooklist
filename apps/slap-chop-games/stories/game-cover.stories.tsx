import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fireEvent, within } from 'storybook/test';

import { GameCover } from '@/components/game-cover';

const meta = {
  component: GameCover,
  decorators: [
    (Story) => (
      <div className="aspect-square w-72 overflow-hidden border border-catalog-border bg-catalog-surface">
        <Story />
      </div>
    ),
  ],
  parameters: {
    a11y: {
      test: 'error',
    },
  },
  tags: ['autodocs'],
  title: 'Catalog/Game cover',
} satisfies Meta<typeof GameCover>;

export default meta;

type Story = StoryObj<typeof meta>;

// storybook-coverage: components/game-cover.tsx
export const Delivered: Story = {
  args: {
    alt: 'A plain cover for Silent Orbit',
    coverUrl:
      'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"%3E%3Crect width="2" height="2" fill="%233c5770"/%3E%3C/svg%3E',
    title: 'Silent Orbit',
  },
};

export const Missing: Story = {
  args: {
    alt: 'Unused cover text',
    coverUrl: null,
    title: 'Circuit Race',
  },
};

export const FailedDelivery: Story = {
  args: {
    alt: 'A failed cover for Silent Orbit',
    coverUrl: 'https://covers.taskmarket.invalid/missing.webp',
    title: 'Silent Orbit',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const image = canvas.getByRole('img', { name: 'A failed cover for Silent Orbit' });

    fireEvent.error(image);

    await expect(
      canvas.getByRole('img', { name: 'Cover unavailable for Silent Orbit' })
    ).toBeVisible();
  },
};
