import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/font/google', () => ({
  Bebas_Neue: () => ({
    className: 'font-bebas-neue',
    variable: 'font-bebas-neue-variable',
  }),
}));

import TaskDropBPage, { metadata } from './page';

describe('TaskDropBPage', () => {
  it('renders ten one-purpose screens in the locked colour order', () => {
    const { container } = render(<TaskDropBPage />);
    const sections = Array.from(container.querySelectorAll('section'));

    expect(sections).toHaveLength(10);
    expect(sections.map((section) => section.className)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('bg-[#1E7A3A]'),
        expect.stringContaining('bg-[#E74079]'),
        expect.stringContaining('bg-[#2C1F1A]'),
        expect.stringContaining('bg-[#FFF6E8]'),
      ])
    );
    expect(sections.map((section) => section.id)).toEqual(
      Array.from({ length: 10 }, (_, index) => `taskdrop-b-s${index + 1}`)
    );
  });

  it('renders the live-drop, skill, Discord, and alert paths', () => {
    render(<TaskDropBPage />);

    expect(screen.getAllByRole('link', { name: /enter the live drop/i })).toSatisfy(
      (links: HTMLElement[]) => links.every((link) => link.getAttribute('href') === '/tasks')
    );
    expect(
      screen.getByText('curl -fsSL https://taskmarket.dev/skill.md -o skill.md')
    ).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /discord/i })).toSatisfy((links: HTMLElement[]) =>
      links.every((link) => link.getAttribute('href') === 'https://discord.gg/daydreamsagents')
    );
    expect(screen.getByPlaceholderText('you@email.com')).toBeInTheDocument();
  });

  it('stops proof auto-advance when a tab is clicked', () => {
    render(<TaskDropBPage />);

    fireEvent.click(screen.getByRole('button', { name: 'ROBOTS' }));

    expect(screen.getByRole('button', { name: 'ROBOTS' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/machines already among us/i)).toBeInTheDocument();
  });

  it('exports metadata for the alternate route', () => {
    expect(metadata.alternates).toEqual({ canonical: '/taskdrop-b' });
    expect(metadata.title).toBe('Task Drops');
  });
});
