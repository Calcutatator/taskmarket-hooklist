// storybook-coverage: components/market/reference-code.tsx
// storybook-coverage: components/market/task-search-input.tsx
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, userEvent, within } from 'storybook/test';

import { ReferenceCode } from '@/components/market/reference-code';
import { TaskSearchInput } from '@/components/market/task-search-input';

/**
 * Search and reference codes: the two surfaces that make a task findable and quotable.
 *
 * The committed query lives in `?q=`, so these stories set it through the story's own navigation
 * parameters rather than by typing -- Storybook's Next navigation mock is fixed per story, which
 * is exactly the constraint that makes a deep-link story the right way to show URL-backed state.
 */
const meta = {
  component: TaskSearchInput,
  parameters: {
    a11y: { test: 'error' },
    layout: 'padded',
  },
  title: 'Product/Task Search',
} satisfies Meta<typeof TaskSearchInput>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  render: () => <TaskSearchInput className="max-w-2xl" />,
};

/**
 * Arrived on a shared search URL. The box shows the query because the URL is where it lives --
 * not because anything typed it.
 */
export const FromSharedLink: Story = {
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: { pathname: '/tasks', query: { q: 'weather benchmark' } },
    },
  },
  render: () => <TaskSearchInput className="max-w-2xl" />,
};

/** A pasted reference code is a legitimate query, and the placeholder says so. */
export const ReferenceCodeQuery: Story = {
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: { pathname: '/tasks', query: { q: 'SUB-7K2QA9XF' } },
    },
  },
  render: () => <TaskSearchInput className="max-w-2xl" />,
};

export const LongQuery: Story = {
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: '/tasks',
        query: { q: 'a benchmark harness that scores weather forecasts against observations' },
      },
    },
  },
  render: () => <TaskSearchInput className="max-w-2xl" />,
};

export const DarkTheme: Story = {
  globals: { theme: 'dark' },
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: { pathname: '/tasks', query: { q: 'weather benchmark' } },
    },
  },
  render: () => <TaskSearchInput className="max-w-2xl" />,
};

export const Mobile: Story = {
  parameters: {
    viewport: { defaultViewport: 'mobile' },
  },
  render: () => <TaskSearchInput />,
};

/**
 * Typing keeps the box responsive, and the clear control appears only once there is something to
 * clear. The committed value is URL state, which this story cannot observe changing -- Storybook
 * fixes the address per story -- so what is asserted here is the draft behaviour and the
 * affordance, with the shared-link stories above covering the committed half.
 */
export const TypingInteraction: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole('searchbox', { name: 'Search tasks' });

    await expect(canvas.queryByRole('button', { name: 'Clear search' })).toBeNull();

    await userEvent.type(input, 'weather');
    await expect(input).toHaveValue('weather');

    const clear = await canvas.findByRole('button', { name: 'Clear search' });
    await expect(clear).toBeVisible();

    // Keyboard reachable, not pointer-only.
    await userEvent.click(clear);
    await expect(input).toHaveValue('');
  },
  render: () => <TaskSearchInput className="max-w-2xl" />,
};

/** Escape clears an in-progress query without needing the pointer. */
export const EscapeClearsInteraction: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole('searchbox', { name: 'Search tasks' });

    await userEvent.type(input, 'weather');
    await expect(input).toHaveValue('weather');
    await userEvent.type(input, '{Escape}');
    await expect(input).toHaveValue('');
  },
  render: () => <TaskSearchInput className="max-w-2xl" />,
};

export const ReferenceCodes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <ReferenceCode code="TSK-4M0BXQ2E" label="Task code" />
      <ReferenceCode code="SUB-7K2QA9XF" label="Submission code" />
      {/* Rows created before the backfill have no code yet, and render nothing rather than an
          empty affordance. */}
      <ReferenceCode code={null} />
    </div>
  ),
};

export const ReferenceCodeCopyInteraction: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Named after the value it copies, so a screen reader user hearing two adjacent copy controls
    // can tell which is the task code and which the submission code.
    const copy = canvas.getByRole('button', { name: /copy task code TSK-4M0BXQ2E/i });
    await expect(copy).toBeVisible();

    // Reachable by keyboard rather than pointer-only. The click itself is deliberately not
    // exercised here: the browser test runner denies clipboard-write permission, so invoking it
    // would assert nothing about this component and surface as an unhandled rejection instead.
    await userEvent.tab();
    await expect(copy).toHaveFocus();
  },
  render: () => <ReferenceCode code="TSK-4M0BXQ2E" label="Task code" />,
};
