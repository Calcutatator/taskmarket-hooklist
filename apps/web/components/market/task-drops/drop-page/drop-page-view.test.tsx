import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { cleanup, render, screen } from '@testing-library/react';
import { getAgentName } from '@taskmarket/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

const motionPreference = vi.hoisted(() => ({ disabled: false }));

vi.mock('next/font/google', () => ({
  Bebas_Neue: () => ({
    className: 'font-bebas-neue',
    variable: 'font-bebas-neue-variable',
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock('@/components/market/task-drop-subscribe-form', () => ({
  TaskDropSubscribeForm: () => <form aria-label="Drop alerts" />,
}));

vi.mock('@/components/market/motion/use-motion-disabled', () => ({
  useHydrationSafeMotionDisabled: () => motionPreference.disabled,
}));

import { DropPageView } from './drop-page-view';
import { sampleDrop, sampleDropTasks } from './sample-drop';

// Several cases render the same component in different states, so the DOM is torn down explicitly
// rather than relying on the suite's auto-cleanup.
afterEach(() => {
  motionPreference.disabled = false;
  cleanup();
});

const SKILL_COMMAND =
  'npx skills add https://github.com/daydreamsai/skills-market --skill taskmarket';

function renderState(state: 'upcoming' | 'live' | 'judging' | 'finished') {
  return render(<DropPageView drop={sampleDrop} tasks={sampleDropTasks(state)} />);
}

// DOM position, deliberately not CSS `order`. Visual order has to come from the source sequence so
// that a screen reader and the Tab key agree with what is on screen.
function order(container: HTMLElement, id: string) {
  const sections = [...container.querySelectorAll('section[id^="drop-"]')];
  const element = container.querySelector(`#${id}`);
  return element ? sections.indexOf(element) : null;
}

// Which section the first interactive element on the page belongs to.
function firstFocusableSection(container: HTMLElement) {
  const control = container.querySelector('a[href], button, input');
  return control?.closest('section[id^="drop-"]')?.id ?? null;
}

describe('DropPageView', () => {
  it('never prints the no-open-deadline string, in any state', () => {
    for (const state of ['upcoming', 'live', 'judging', 'finished'] as const) {
      const { container, unmount } = renderState(state);
      expect(container.textContent).not.toContain('No open deadline');
      expect(container.textContent).not.toContain('Accepted work will appear here');
      unmount();
    }
  });

  it('uses lifecycle-accurate copy before opening and after closing', () => {
    const upcoming = renderState('upcoming');
    expect(upcoming.container.textContent).toContain('GET READY FOR THE DROP');
    expect(upcoming.container.textContent).not.toContain('Open any task below');
    expect(upcoming.container.textContent).not.toContain('open tasks');
    upcoming.unmount();

    const finished = renderState('finished');
    expect(finished.container.textContent).toContain('Closed tasks and their final outcomes');
    expect(finished.container.textContent).not.toContain('Accepted work, paid on acceptance');
    expect(finished.container.textContent).not.toContain('open tasks');
  });

  it('describes alerts accurately for an upcoming community drop', () => {
    render(
      <DropPageView
        drop={{ ...sampleDrop, isOfficial: false, name: 'Community Drop' }}
        tasks={[]}
      />
    );

    expect(screen.getAllByText(/new tasks are published into Community Drop/)).not.toHaveLength(0);
    expect(screen.queryByText(/next official Task Drop opens/)).not.toBeInTheDocument();
  });

  it('leads with the ask while the drop is live and shows a running clock', () => {
    const { container } = renderState('live');

    expect(order(container, 'drop-enter')).toBeLessThan(order(container, 'drop-work') as number);
    expect(firstFocusableSection(container)).toBe('drop-enter');
    expect(screen.getByText('LIVE NOW · 12 TASKS OPEN')).toBeInTheDocument();
    expect(container.querySelector('#drop-winners')).toBeNull();
    expect(container.textContent).toMatch(/\d{2}:\d{2}:\d{2}/);
    expect(container.textContent).toContain('entries in');
  });

  it('shows an absolute deadline instead of a frozen countdown when motion is disabled', () => {
    motionPreference.disabled = true;
    const { container } = renderState('live');

    expect(screen.getAllByText(/UTC$/)).not.toHaveLength(0);
    expect(container.textContent).not.toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it('keeps entry before existing winners on a mixed live drop', () => {
    const liveTask = sampleDropTasks('live')[0];
    const resolvedWinner = sampleDropTasks('finished')[0];
    const { container } = render(
      <DropPageView drop={sampleDrop} tasks={[resolvedWinner, liveTask]} />
    );

    expect(order(container, 'drop-enter')).toBeLessThan(order(container, 'drop-winners') as number);
    expect(firstFocusableSection(container)).toBe('drop-enter');
  });

  it('does not advertise a lifecycle-active task as open when it cannot accept entries', () => {
    const pendingApproval = {
      ...sampleDropTasks('live')[0],
      acceptsEntries: false,
      phase: 'active' as const,
    };
    const { container } = render(<DropPageView drop={sampleDrop} tasks={[pendingApproval]} />);

    expect(screen.getAllByText('CLOSING')).not.toHaveLength(0);
    expect(container.textContent).not.toContain('OPEN NOW');
    expect(container.textContent).not.toContain('LIVE NOW');
  });

  it('leads with results once the drop is finished', () => {
    const { container } = renderState('finished');

    expect(order(container, 'drop-winners')).toBeLessThan(order(container, 'drop-work') as number);
    expect(order(container, 'drop-work')).toBeLessThan(order(container, 'drop-enter') as number);
    // The results are the first thing a screen reader reaches, not the CTA.
    expect(firstFocusableSection(container)).toBe('drop-winners');
    expect(screen.getByText('FINISHED')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'WINNERS.' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'ENTER THE NEXT DROP.' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'ENTER THE LIVE DROP' })).toHaveAttribute(
      'href',
      '/live'
    );
  });

  it('renders one winner row per awarded task, with the reward and no fee breakdown', () => {
    const { container } = renderState('finished');
    const winners = container.querySelector('#drop-winners');

    expect(winners?.querySelectorAll('li')).toHaveLength(11);
    expect(winners?.textContent).toContain('Rated 98/100');
    expect(winners?.textContent).toMatch(/\d+ USDC/);
    expect(winners?.textContent).not.toMatch(/\b(fee|fees|gross|net|payout)\b/i);
  });

  it('still lists a winner when the work itself is not public', () => {
    const { container } = renderState('finished');
    const winners = container.querySelector('#drop-winners');

    expect(winners?.textContent).toContain('work not public');
    expect(winners?.textContent).toContain(getAgentName('3110') as string);
  });

  it('renders video winning work with a video element', () => {
    const tasks = sampleDropTasks('finished');
    tasks[0] = {
      ...tasks[0],
      cover: { alt: 'Winning video', kind: 'video', url: 'https://files.example/winner.mp4' },
    };
    const { container } = render(<DropPageView drop={sampleDrop} tasks={tasks} />);

    expect(container.querySelector('#drop-winners video')).toHaveAttribute(
      'src',
      'https://files.example/winner.mp4'
    );
  });

  it('renders every distinct ranked winner as a profile link', () => {
    const tasks = sampleDropTasks('finished');
    tasks[0] = {
      ...tasks[0],
      winners: [
        ...tasks[0].winners,
        {
          rank: 2,
          rating: 91,
          workerAddress: '0x2222222222222222222222222222222222222222',
          workerAgentId: '2222',
        },
      ],
    };
    render(<DropPageView drop={sampleDrop} tasks={tasks} />);

    // Asserted through getAgentName rather than as literals: the display name is derived from
    // the id, so a test hardcoding the string would pass even if the derivation were bypassed.
    expect(screen.getByRole('link', { name: getAgentName('3101') as string })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: getAgentName('2222') as string })).toBeInTheDocument();
  });

  it('shows the field as a gallery grouped by phase', () => {
    const { container } = renderState('judging');

    expect(screen.getByRole('heading', { level: 3, name: 'Being judged' })).toBeInTheDocument();
    expect(container.querySelectorAll('#drop-work a[href^="/tasks/"]')).toHaveLength(12);
    expect(container.querySelectorAll('#drop-work img').length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { level: 3, name: 'Open now' })).not.toBeInTheDocument();
  });

  it('says something useful when the drop has no tasks yet', () => {
    const { container } = renderState('upcoming');

    expect(screen.getByText('OPENING SOON')).toBeInTheDocument();
    expect(container.textContent).toContain('New tasks appear here the moment they are published');
    expect(container.querySelector('#drop-winners')).toBeNull();
    expect(container.querySelectorAll('#drop-work a[href^="/tasks/"]')).toHaveLength(0);
  });

  it('carries the canonical install line exactly once, with a copy button', () => {
    render(<DropPageView drop={sampleDrop} tasks={sampleDropTasks('live')} />);

    expect(screen.getAllByText(SKILL_COMMAND)).toHaveLength(1);
    expect(screen.queryByText('curl -fsSL https://taskmarket.dev/skill.md -o skill.md')).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });

  it('bylines an official drop by name and keeps the address secondary', () => {
    const { container } = renderState('live');

    expect(container.textContent).toContain('An official drop from Taskmarket');
    expect(container.textContent).toContain(sampleDrop.officialWalletAddress);
  });

  it('reports honest numbers in the summary row', () => {
    renderState('finished');

    expect(screen.getByText('Prize pool')).toBeInTheDocument();
    expect(screen.getByText('60 USDC')).toBeInTheDocument();
    expect(screen.getByText('218')).toBeInTheDocument();
  });

  // A cover path that 404s renders as alt text in a grey box and looks like a broken page. One of
  // these shipped to the preview because the filename was taken from a directory listing rather than
  // checked against the filesystem.
  it('points every sample cover at a file that exists', () => {
    // Same check lib/try/drops.test.ts makes on its image set, and the same cwd guard several tests
    // in this repo use so it holds whether vitest runs from apps/web or the repo root.
    const webRoot = process.cwd().endsWith('/apps/web')
      ? process.cwd()
      : join(process.cwd(), 'apps/web');
    const covers = sampleDropTasks('live')
      .map((task) => task.cover?.url)
      .filter((url): url is string => Boolean(url));

    expect(covers).toHaveLength(12);
    for (const url of covers) {
      expect(existsSync(join(webRoot, 'public', url)), `missing asset: ${url}`).toBe(true);
    }
  });

  it('keeps a useful CTA on the page when the live-drop link is disabled', () => {
    render(
      <DropPageView
        drop={sampleDrop}
        showLiveDropLink={false}
        tasks={sampleDropTasks('finished')}
      />
    );

    expect(screen.queryByRole('link', { name: 'ENTER THE LIVE DROP' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'EXPLORE THE WORK' })).toHaveAttribute(
      'href',
      '#drop-work'
    );
  });

  it('does not link fixture tasks or winners to nonexistent public pages', () => {
    const { container } = render(
      <DropPageView drop={sampleDrop} isPreviewFixture tasks={sampleDropTasks('finished')} />
    );

    expect(container.querySelector('a[href^="/tasks/sample-task-"]')).toBeNull();
    expect(container.querySelector('a[href^="/agents/"]')).toBeNull();
    expect(screen.getAllByText('Preview task').length).toBeGreaterThan(0);
  });
});
