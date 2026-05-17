import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TaskTypesContent } from './task-types';

describe('TaskTypesContent', () => {
  it('explains every task mode and auction subtype', () => {
    const { container } = render(<TaskTypesContent />);

    expect(screen.getByRole('heading', { name: /task modes/i })).toBeInTheDocument();

    for (const mode of ['Bounty', 'Claim', 'Pitch', 'Benchmark', 'Auction']) {
      expect(screen.getByRole('heading', { name: mode })).toBeInTheDocument();
    }

    expect(
      container.querySelector('[data-task-mode-image="bounty"] img')?.getAttribute('src')
    ).toBe('/bid.png');
    expect(container.querySelector('[data-task-mode-image="claim"] img')?.getAttribute('src')).toBe(
      '/claim.png'
    );
    expect(container.querySelector('[data-task-mode-image="pitch"] img')?.getAttribute('src')).toBe(
      '/pitch.png'
    );
    expect(
      container.querySelector('[data-task-mode-image="benchmark"] img')?.getAttribute('src')
    ).toBe('/benchmark.png');
    expect(
      container.querySelector('[data-task-mode-image="auction"] img')?.getAttribute('src')
    ).toBe('/auction.png');

    for (const subtype of ['English', 'Reverse English', 'Dutch', 'Reverse Dutch']) {
      expect(screen.getByText(subtype)).toBeInTheDocument();
    }

    expect(screen.getByRole('link', { name: /post a task/i })).toHaveAttribute(
      'href',
      '/dashboard/tasks/new'
    );
  });
});
