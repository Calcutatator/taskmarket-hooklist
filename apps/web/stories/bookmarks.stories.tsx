// storybook-coverage: components/market/bookmark-button.tsx
// storybook-coverage: components/market/bookmarks-client.tsx
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';

import { BookmarkButton } from '@/components/market/bookmark-button';
import { BookmarksClient } from '@/components/market/bookmarks-client';

/**
 * The bookmark control.
 *
 * Disconnected is the state worth looking at: ADR-0100 requires a connected wallet, so the
 * control has to say so rather than failing quietly or writing somewhere that would later need
 * reconciling. These stories render the disconnected case, which is what an anonymous visitor to
 * a public task actually sees; the connected states need a wallet and a signed read-auth header,
 * which belong to the integrated route rather than to an isolated story.
 */
const meta = {
  component: BookmarkButton,
  parameters: {
    a11y: { test: 'error' },
    layout: 'centered',
  },
  title: 'Product/Bookmarks',
} satisfies Meta<typeof BookmarkButton>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Disconnected: Story = {
  args: { entityId: 'task-1', entityType: 'task' },
};

export const DisconnectedDark: Story = {
  args: { entityId: 'task-1', entityType: 'task' },
  globals: { theme: 'dark' },
};

export const DisconnectedMobile: Story = {
  args: { entityId: 'task-1', entityType: 'task' },
  parameters: { viewport: { defaultViewport: 'mobile' } },
};

/**
 * The disconnected control is disabled but still carries a label that explains why, so a screen
 * reader user is told what to do rather than just meeting a dead control.
 */
export const DisconnectedInteraction: Story = {
  args: { entityId: 'task-1', entityType: 'task' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: /connect a wallet to save/i });
    await expect(button).toBeDisabled();
  },
};

/**
 * The saved list with no wallet connected. This is what an anonymous visitor to
 * /dashboard/bookmarks sees, and it has to explain why the list is empty rather than looking
 * broken -- bookmarks are wallet-scoped by ADR-0100, which is the whole reason they survive a
 * change of device.
 */
export const SavedListDisconnected: StoryObj<typeof BookmarksClient> = {
  render: () => <BookmarksClient shareBaseUrl="https://taskmarket.dev" />,
};

export const SavedListDisconnectedDark: StoryObj<typeof BookmarksClient> = {
  globals: { theme: 'dark' },
  render: () => <BookmarksClient shareBaseUrl="https://taskmarket.dev" />,
};

export const SavedListDisconnectedInteraction: StoryObj<typeof BookmarksClient> = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText(/connect a wallet to see the things you have saved/i)
    ).toBeVisible();
  },
  render: () => <BookmarksClient shareBaseUrl="https://taskmarket.dev" />,
};
