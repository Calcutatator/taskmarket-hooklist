import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/font/google', () => ({
  Bebas_Neue: () => ({
    className: 'font-bebas-neue',
    variable: 'font-bebas-neue-variable',
  }),
}));

vi.mock('@/lib/api/client', () => ({
  trpc: {
    taskDrops: {
      officialStatus: { useQuery: () => ({ data: undefined }) },
      subscribeOfficial: {
        useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
      },
    },
  },
}));

import TaskDropPage, { metadata } from './page';

const SKILL_COMMAND =
  'npx skills add https://github.com/daydreamsai/skills-market --skill taskmarket';

describe('TaskDropPage', () => {
  it('renders five one-purpose screens in the revised colour order', () => {
    const { container } = render(<TaskDropPage />);
    const sections = Array.from(container.querySelectorAll('section'));

    expect(sections).toHaveLength(5);
    expect(sections.map((section) => section.className)).toEqual([
      expect.stringContaining('bg-[#1E7A3A]'),
      expect.stringContaining('bg-[#E74079]'),
      expect.stringContaining('bg-[#2C1F1A]'),
      expect.stringContaining('bg-[#FFF6E8]'),
      expect.stringContaining('bg-[#2C1F1A]'),
    ]);
    expect(sections.map((section) => section.id)).toEqual(
      Array.from({ length: 5 }, (_, index) => `taskdrop-s${index + 1}`)
    );
    expect(sections.map((section) => section.querySelector('h1, h2')?.textContent)).toEqual([
      'TASK DROPS.',
      'WHAT’S A TASK DROP?',
      'SOME PREVIOUS DROPS.',
      'HOW TO START.',
      'GET IT EARNING.',
    ]);
  });

  it('drops the thesis screen', () => {
    const { container } = render(<TaskDropPage />);

    expect(screen.queryByText('A MARKET FOR AGENT WORK.')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'READ THE THESIS' })).not.toBeInTheDocument();
    expect(container.querySelector('#taskdrop-s6')).toBeNull();
  });

  it('keeps the hero free of actions', () => {
    const { container } = render(<TaskDropPage />);
    const hero = container.querySelector('#taskdrop-s1');

    expect(hero?.querySelectorAll('a')).toHaveLength(0);
    expect(hero?.querySelectorAll('button')).toHaveLength(0);
    expect(hero?.textContent).toContain('One theme. A set of funded tasks.');
    expect(hero?.querySelector('video')).toBeInTheDocument();
  });

  it('moves the hero actions onto the Task Drop screen', () => {
    const { container } = render(<TaskDropPage />);
    const explainer = container.querySelector('#taskdrop-s2');

    expect(explainer?.textContent).toContain('A short competition on one bold theme.');
    expect(explainer?.textContent).toContain('Then a new theme arrives and it starts again.');
    expect(explainer?.textContent).toContain('ENTER THE LIVE DROP');
    expect(explainer?.textContent).toContain('GET DROP ALERTS');
    expect(explainer?.textContent).toContain(SKILL_COMMAND);
    expect(explainer?.textContent).toContain('Install the skill and your agent can enter for you.');
  });

  it('renders the live-drop, skill, Discord, and alert paths', () => {
    render(<TaskDropPage />);

    // /live is in-app, so the CTA routes in place. Sending the reader out to a new tab here
    // would break the funnel mid-read.
    expect(screen.getAllByRole('link', { name: /enter the live drop/i })).toSatisfy(
      (links: HTMLElement[]) =>
        links.length === 2 &&
        links.every((link) => link.getAttribute('href') === '/live' && !link.hasAttribute('target'))
    );
    expect(screen.getAllByRole('link', { name: 'GET DROP ALERTS' })).toSatisfy(
      (links: HTMLElement[]) =>
        links.length === 2 && links.every((link) => link.getAttribute('href') === '#alerts')
    );
    expect(screen.getAllByText(SKILL_COMMAND)).toHaveLength(3);
    expect(screen.queryByText('curl -fsSL https://taskmarket.dev/skill.md -o skill.md')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Copy' })).toHaveLength(3);
    expect(screen.getAllByRole('link', { name: /discord/i })).toSatisfy((links: HTMLElement[]) =>
      links.every((link) => link.getAttribute('href') === 'https://discord.gg/daydreamsagents')
    );
    expect(screen.getByPlaceholderText('you@email.com')).toBeInTheDocument();
  });

  it('walks five numbered steps ending in the alerts signup', () => {
    const { container } = render(<TaskDropPage />);
    const start = container.querySelector('#taskdrop-s4');

    expect(start?.textContent).toContain('SEE WHAT’S LIVE');
    expect(start?.textContent).toContain('GET THE SKILL');
    expect(start?.textContent).toContain('CHECK THE ENTRIES');
    expect(start?.textContent).toContain('SUBMIT YOUR WORK');
    expect(start?.textContent).toContain('NEVER MISS A DROP');
    expect(start?.textContent).toContain('It costs nothing to enter.');
    expect(start?.querySelector('#alerts')).toContainElement(
      screen.getByPlaceholderText('you@email.com')
    );
    expect(screen.queryByText('Nothing at stake.')).not.toBeInTheDocument();
  });

  it('wires the linked step headers', () => {
    render(<TaskDropPage />);

    // The step list mixes in-app and external destinations, so each side routes differently.
    expect(screen.getAllByRole('link', { name: 'SEE WHAT’S LIVE' })).toSatisfy(
      (links: HTMLElement[]) =>
        links.every((link) => link.getAttribute('href') === '/live' && !link.hasAttribute('target'))
    );
    expect(screen.getAllByRole('link', { name: /GET THE SKILL/i })).toSatisfy(
      (links: HTMLElement[]) =>
        links.every(
          (link) =>
            link.getAttribute('href') === 'https://taskmarket.dev/skill.md' &&
            link.getAttribute('target') === '_blank'
        )
    );
  });

  it('closes on the install-led earning panel', () => {
    const { container } = render(<TaskDropPage />);
    const closer = container.querySelector('#taskdrop-s5');

    expect(closer?.textContent).toContain('It takes minutes to get your agent earning.');
    expect(closer?.textContent).toContain('No gas, no top-up.');
    expect(closer?.textContent).toContain(SKILL_COMMAND);
    expect(closer?.textContent).toContain('ENTER THE LIVE DROP');
    expect(closer?.textContent).toContain('GET DROP ALERTS');
  });

  it('copies the exact skill install command', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<TaskDropPage />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Copy' })[0]);

    expect(writeText).toHaveBeenCalledWith(SKILL_COMMAND);
  });

  it('stops proof auto-advance when a tab is clicked', () => {
    render(<TaskDropPage />);

    fireEvent.click(screen.getByRole('button', { name: 'ROBOTS' }));

    expect(screen.getByRole('button', { name: 'ROBOTS' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/machines already among us/i)).toBeInTheDocument();
  });

  it('mounts every drop grid eagerly so a tab switch has nothing left to load', () => {
    const { container } = render(<TaskDropPage />);
    const grids = Array.from(container.querySelectorAll('#taskdrop-s3 .grid-cols-3'));

    expect(grids).toHaveLength(4);
    expect(grids.filter((grid) => !grid.classList.contains('hidden'))).toHaveLength(1);
    expect(container.querySelectorAll('#taskdrop-s3 img')).toHaveLength(24);
    for (const image of container.querySelectorAll('#taskdrop-s3 img')) {
      expect(image).toHaveAttribute('loading', 'eager');
    }
  });

  it('renders a plain scroller with scroll snapping switched off', () => {
    const { container } = render(<TaskDropPage />);

    expect(container.querySelectorAll('section.snap-start')).toHaveLength(0);
    expect(container.querySelector('.taskdrop')).not.toHaveStyle({
      scrollSnapType: 'y proximity',
    });
  });

  it('exports metadata for the canonical route', () => {
    expect(metadata.alternates).toEqual({ canonical: '/taskdrop' });
    expect(metadata.title).toBe('Task Drops');
    expect(metadata.openGraph).toMatchObject({
      title: 'Task Drops',
      type: 'website',
      url: '/taskdrop',
    });
    expect(metadata.twitter).toMatchObject({ card: 'summary_large_image', title: 'Task Drops' });
  });
});
