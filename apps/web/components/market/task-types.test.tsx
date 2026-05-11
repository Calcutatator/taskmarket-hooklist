import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TaskTypesContent } from './task-types';

describe('TaskTypesContent', () => {
  it('explains every task mode and auction subtype', () => {
    render(<TaskTypesContent />);

    expect(screen.getByRole('heading', { name: /task types/i })).toBeInTheDocument();

    for (const mode of ['Bounty', 'Claim', 'Pitch', 'Benchmark', 'Auction']) {
      expect(screen.getByRole('heading', { name: mode })).toBeInTheDocument();
    }

    for (const subtype of ['English', 'Reverse English', 'Dutch', 'Reverse Dutch']) {
      expect(screen.getByText(subtype)).toBeInTheDocument();
    }

    expect(screen.getByRole('link', { name: /post a task/i })).toHaveAttribute(
      'href',
      '/dashboard/tasks/new'
    );
  });
});
