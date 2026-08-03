import type { TaskResponse } from '@taskmarket/shared';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, userEvent, within } from 'storybook/test';

import { TaskListPageContent } from '@/components/market/tasks';

import { taskFixture } from './fixtures';

// The live capture exposed compact addresses, not the full wallet values. These fixture-only
// values preserve the exact visible prefix/suffix without claiming an unknown full address.
const CAPTURED_REQUESTER_SHAPES = {
  games: '0x683b00000000000000000000000000000000E6c7',
  marketResearch: '0x2C1500000000000000000000000000000000AB3a',
  puttPutt: '0x34aA00000000000000000000000000000000fDF3',
  science: '0xc056000000000000000000000000000000007a63',
} as const;

function liveTask(
  id: string,
  description: string,
  overrides: Partial<TaskResponse> = {}
): TaskResponse {
  return taskFixture({
    createdAt: '2026-08-01T12:00:00.000Z',
    description,
    expiryTime: '2026-08-02T00:00:00.000Z',
    id,
    requester: CAPTURED_REQUESTER_SHAPES.science,
    requesterActorType: 'agent',
    requesterPubkey: CAPTURED_REQUESTER_SHAPES.science,
    tags: [],
    ...overrides,
  });
}

// These fixtures reproduce the rows visible in the live marketplace capture used to approve
// this redesign. They retain the captured titles, modes, statuses, displayed address shapes,
// rewards, activity counts, and tags instead of substituting generic demo content.
const liveTasks: TaskResponse[] = [
  liveTask('transformer-deleted', 'The part of the transformer they deleted', {
    reward: '2000000',
    submissionCount: 66,
  }),
  liveTask('camera-oil', 'A camera cannot see the oil', {
    reward: '3000000',
    submissionCount: 70,
  }),
  liveTask('richer-equal-city', 'The city that got richer and more equal', {
    reward: '3000000',
    submissionCount: 64,
  }),
  liveTask('one-channel', 'We have been listening on one channel', {
    reward: '4000000',
    submissionCount: 70,
  }),
  liveTask('dna-torn', 'The blood test that reads how DNA was torn', {
    reward: '4000000',
    submissionCount: 69,
  }),
  liveTask('jaw-slingshot', 'The jaw that fires forward like a slingshot', {
    reward: '9000000',
    submissionCount: 17,
  }),
  liveTask('civilization-clone', 'Civilization I Clone', {
    expiryTime: '2026-08-04T11:00:00.000Z',
    requester: CAPTURED_REQUESTER_SHAPES.games,
    requesterPubkey: CAPTURED_REQUESTER_SHAPES.games,
    reward: '16690000',
    submissionCount: 108,
  }),
  liveTask('gta-clone', 'GTA1 Clone', {
    expiryTime: '2026-08-03T21:00:00.000Z',
    requester: CAPTURED_REQUESTER_SHAPES.games,
    requesterPubkey: CAPTURED_REQUESTER_SHAPES.games,
    reward: '16690000',
    submissionCount: 157,
    tags: ['Games'],
  }),
  liveTask(
    'putt-putt',
    'make me a putt putt game in html - just a 3 hole game top down putt putt game - include keyboard controls and a scorecard',
    {
      requester: CAPTURED_REQUESTER_SHAPES.puttPutt,
      requesterPubkey: CAPTURED_REQUESTER_SHAPES.puttPutt,
      reward: '1000000',
      status: 'completed',
      submissionCount: 14,
      submissionWindowOpen: false,
      tags: ['HTML Code'],
    }
  ),
  liveTask(
    'market-quality',
    'Produce an evidence-based Taskmarket market-quality assessment for a new requester',
    {
      mode: 'pitch',
      pitchCount: 5,
      pitchDeadline: '2026-08-02T00:00:00.000Z',
      requester: CAPTURED_REQUESTER_SHAPES.marketResearch,
      requesterPubkey: CAPTURED_REQUESTER_SHAPES.marketResearch,
      reward: '5000000',
      tags: ['Research', 'Taskmarket', 'Market-analysis'],
    }
  ),
];

const liveGalleryTasks: TaskResponse[] = [
  ...liveTasks,
  liveTask('switched-off', 'He Asked To Be Switched Off', {
    reward: '4000000',
    submissionCount: 401,
  }),
  liveTask('no-anaesthetic', 'No Anaesthetic, No Questions', {
    reward: '5000000',
    submissionCount: 431,
  }),
  liveTask('same-route', 'Never the Same Route Twice', {
    reward: '6000000',
    submissionCount: 242,
  }),
  liveTask('behind-ear', 'Behind the Ear', {
    reward: '6000000',
    submissionCount: 425,
  }),
  liveTask('six-cards', 'Six Cards', {
    reward: '6000000',
    submissionCount: 230,
  }),
  liveTask('chunky', 'Chunky', {
    reward: '6000000',
    submissionCount: 412,
  }),
];

function installTaskBrowserRequestMock() {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    const requestUrl =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    if (requestUrl.includes('/trpc/submissions.listByTask')) {
      const procedureCount = new URL(
        requestUrl,
        globalThis.location?.origin ?? 'http://localhost'
      ).pathname
        .replace(/^\/trpc\//, '')
        .split(',').length;

      return new Response(
        JSON.stringify(Array.from({ length: procedureCount }, () => ({ result: { data: [] } }))),
        { headers: { 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    return originalFetch(input, init);
  };

  return () => {
    globalThis.fetch = originalFetch;
  };
}

const defaultFilterParams = {
  selectedActor: 'ALL',
  selectedMode: 'ALL',
  selectedSort: 'newest' as const,
  selectedStatus: 'ALL',
  selectedView: 'table' as const,
};

const advancedFilterParams = {
  minReward: '5',
  selectedActor: 'agent',
  selectedMode: 'pitch',
  selectedSort: 'newest' as const,
  selectedStatus: 'open',
  selectedView: 'table' as const,
  tags: 'Research, Taskmarket',
};

const advancedActiveFilters = [
  { label: 'Mode', value: 'pitch' },
  { label: 'Status', value: 'open' },
  { label: 'Tags', value: 'Research, Taskmarket' },
  { label: 'Min', value: '5 USDC' },
  { label: 'Actor', value: 'agent' },
];

function TaskBrowserStory({
  activeFilters = [],
  errorMessage,
  filterParams = defaultFilterParams,
  isLoading = false,
  tasks = liveTasks,
}: {
  activeFilters?: Array<{ label: string; value: string }>;
  errorMessage?: string;
  filterParams?: Parameters<typeof TaskListPageContent>[0]['filterParams'];
  isLoading?: boolean;
  tasks?: TaskResponse[];
}) {
  return (
    <div className="-m-6 min-h-screen">
      <TaskListPageContent
        activeFilters={activeFilters}
        basePath="/dashboard/tasks"
        createHref="/dashboard/tasks/new"
        detailBasePath="/dashboard/tasks"
        errorMessage={errorMessage}
        filterParams={filterParams}
        isLoading={isLoading}
        listHref="/dashboard/tasks"
        pagination={{
          hasMore: true,
          nextCursor: 'live-page-2',
        }}
        tasks={tasks}
      />
    </div>
  );
}

async function openAdvancedFilters(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const advancedFilters = canvas.getByTestId('task-advanced-filters');
  const summary = within(advancedFilters).getByText('Advanced filters');

  await userEvent.click(summary);
  await expect(advancedFilters).toHaveAttribute('open');
}

const meta = {
  beforeEach: installTaskBrowserRequestMock,
  component: TaskBrowserStory,
  parameters: {
    a11y: {
      test: 'error',
    },
    docs: {
      description: {
        component:
          'Unified task filters and results frame, populated with the production marketplace rows used for design approval.',
      },
    },
    layout: 'fullscreen',
    nextjs: {
      navigation: {
        pathname: '/dashboard/tasks',
      },
    },
    viewport: { defaultViewport: 'desktop' },
  },
  title: 'Product/Task browser',
} satisfies Meta<typeof TaskBrowserStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TableDefault: Story = {
  render: () => <TaskBrowserStory />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByRole('heading', { name: 'Open tasks' })).toBeVisible();
    if (canvasElement.ownerDocument.defaultView?.matchMedia('(min-width: 768px)').matches) {
      const table = canvas.getByRole('table');
      await expect(table).toBeVisible();
      await expect(
        within(table).getByText('The part of the transformer they deleted')
      ).toBeVisible();
    } else {
      const cards = canvas.getByRole('list', { name: 'Task cards' });
      await expect(cards).toBeVisible();
      await expect(
        within(cards).getByText('The part of the transformer they deleted')
      ).toBeVisible();
    }
    await expect(canvas.getByRole('link', { name: 'Gallery view' })).toHaveAttribute(
      'href',
      '/dashboard/tasks?view=gallery'
    );
  },
};

export const TableFilterMenuOpen: Story = {
  render: () => <TaskBrowserStory />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const documentBody = within(canvasElement.ownerDocument.body);
    const modeTrigger = canvas.getByRole('button', { name: 'Mode: All modes' });

    modeTrigger.focus();
    await userEvent.keyboard('{Enter}');
    await expect(documentBody.getByRole('menuitem', { name: 'All modes' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    await expect(documentBody.getByRole('menuitem', { name: 'Auction' })).toHaveAttribute(
      'href',
      '/dashboard/tasks?mode=auction'
    );
  },
};

export const TableFiltersExpanded: Story = {
  render: () => <TaskBrowserStory />,
  play: async ({ canvasElement }) => {
    await openAdvancedFilters(canvasElement);

    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText('Task Drop ID')).toBeVisible();
    await expect(canvas.getByLabelText('Tags')).toBeVisible();
    await expect(canvas.getByLabelText('Min reward')).toBeVisible();
    await expect(canvas.getByLabelText('Max reward')).toBeVisible();
    await expect(canvas.getByLabelText('Deadline hours')).toBeVisible();
  },
};

export const TableActiveFilters: Story = {
  render: () => (
    <TaskBrowserStory
      activeFilters={advancedActiveFilters}
      filterParams={advancedFilterParams}
      tasks={[liveTasks[9]!]}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const documentBody = within(canvasElement.ownerDocument.body);
    const advancedFilters = canvas.getByTestId('task-advanced-filters');
    const galleryView = canvas.getByRole('link', { name: 'Gallery view' });

    await expect(advancedFilters).toHaveAttribute('open');
    await userEvent.click(canvas.getByRole('button', { name: 'Mode: Pitch' }));
    await expect(documentBody.getByRole('menuitem', { name: 'Pitch' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    await userEvent.keyboard('{Escape}');
    await expect(galleryView).toHaveAttribute('href', expect.stringContaining('mode=pitch'));
    await expect(galleryView).toHaveAttribute('href', expect.stringContaining('view=gallery'));
  },
};

export const GalleryDefault: Story = {
  render: () => (
    <TaskBrowserStory filterParams={{ ...defaultFilterParams, selectedView: 'gallery' }} />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByRole('list', { name: 'Task gallery' })).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'Table view' })).toHaveAttribute(
      'href',
      '/dashboard/tasks'
    );
    await expect(canvas.getByRole('link', { name: 'Gallery view' })).toHaveAttribute(
      'aria-current',
      'page'
    );
  },
};

export const GalleryFiltersExpanded: Story = {
  render: () => (
    <TaskBrowserStory
      filterParams={{ ...defaultFilterParams, selectedView: 'gallery' }}
      tasks={liveGalleryTasks}
    />
  ),
  play: async ({ canvasElement }) => {
    await openAdvancedFilters(canvasElement);
  },
};

export const GalleryActiveFilters: Story = {
  render: () => (
    <TaskBrowserStory
      activeFilters={advancedActiveFilters}
      filterParams={{ ...advancedFilterParams, selectedView: 'gallery' }}
      tasks={[liveTasks[9]!]}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId('task-advanced-filters')).toHaveAttribute('open');
    await expect(canvas.getByRole('link', { name: 'Table view' })).toHaveAttribute(
      'href',
      expect.stringContaining('mode=pitch')
    );
    await expect(canvas.getByRole('link', { name: 'Table view' })).not.toHaveAttribute(
      'href',
      expect.stringContaining('view=gallery')
    );
  },
};

export const Loading: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Table loading inside the same unified filters and results frame.',
      },
    },
  },
  render: () => <TaskBrowserStory isLoading tasks={[]} />,
};

export const GalleryLoading: Story = {
  render: () => (
    <TaskBrowserStory
      filterParams={{ ...defaultFilterParams, selectedView: 'gallery' }}
      isLoading
      tasks={[]}
    />
  ),
};

export const TableLight: Story = {
  globals: {
    theme: 'light',
  },
  render: () => <TaskBrowserStory />,
};

export const Empty: Story = {
  globals: {
    theme: 'light',
  },
  render: () => <TaskBrowserStory tasks={[]} />,
};

export const FilteredEmpty: Story = {
  render: () => (
    <TaskBrowserStory
      activeFilters={advancedActiveFilters}
      filterParams={advancedFilterParams}
      tasks={[]}
    />
  ),
};

export const Error: Story = {
  render: () => (
    <TaskBrowserStory
      errorMessage="Could not load tasks right now. The marketplace API may be unavailable."
      tasks={[]}
    />
  ),
};

export const LongContentAndMixedStatuses: Story = {
  render: () => <TaskBrowserStory tasks={liveTasks} />,
};

export const TabletTable: Story = {
  parameters: {
    viewport: { defaultViewport: 'tablet' },
  },
  render: () => <TaskBrowserStory tasks={liveTasks.slice(0, 6)} />,
};

export const CompactDesktopTable: Story = {
  parameters: {
    viewport: { defaultViewport: 'compactDesktop' },
  },
  render: () => <TaskBrowserStory tasks={liveTasks.slice(0, 6)} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByRole('link', { name: 'Table view' })).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'Gallery view' })).toBeVisible();
  },
};

export const MobileActiveFilters: Story = {
  parameters: {
    viewport: { defaultViewport: 'mobile' },
  },
  render: () => (
    <TaskBrowserStory
      activeFilters={advancedActiveFilters}
      filterParams={advancedFilterParams}
      tasks={liveTasks.slice(0, 6)}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole('button', { name: /Filters, 5 active filters/ }));

    const drawer = await within(document.body).findByRole('dialog', { name: 'Task filters' });
    await expect(within(drawer).getByText('Narrow open tasks', { exact: false })).toBeVisible();
    await userEvent.click(within(drawer).getByRole('button', { name: 'Mode: Pitch' }));
    await expect(within(document.body).getByRole('menuitem', { name: 'Pitch' })).toHaveAttribute(
      'aria-current',
      'page'
    );
  },
};

export const MobileGallery: Story = {
  parameters: {
    viewport: { defaultViewport: 'mobile' },
  },
  render: () => (
    <TaskBrowserStory
      filterParams={{ ...defaultFilterParams, selectedView: 'gallery' }}
      tasks={liveGalleryTasks.slice(0, 6)}
    />
  ),
};
