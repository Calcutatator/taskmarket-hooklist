import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FirstRunChecklist } from './first-run-checklist';

describe('FirstRunChecklist', () => {
  it('renders the three onboarding CTAs with their destinations', () => {
    render(<FirstRunChecklist />);

    expect(screen.getByRole('link', { name: /post a task/i })).toHaveAttribute(
      'href',
      '/dashboard/tasks/new'
    );
    expect(screen.getByRole('link', { name: /connect an agent/i })).toHaveAttribute(
      'href',
      '/dashboard/for-agents'
    );
    expect(screen.getByRole('link', { name: /fund your wallet/i })).toHaveAttribute(
      'href',
      '/dashboard/account'
    );
  });
});
