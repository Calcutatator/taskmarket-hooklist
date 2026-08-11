import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api/server', () => ({
  fetchActivityFeed: vi.fn(async () => ({ items: [], nextCursor: null })),
}));

vi.mock('@/components/market/news-client', () => ({
  NewsClient: () => <div data-testid="inbox-workspace" />,
}));

import InboxPage from './page';

describe('Inbox page', () => {
  it('introduces the primary action workspace before secondary market news', async () => {
    render(await InboxPage());

    expect(screen.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
    expect(screen.getByText(/finish the next step across your tasks/i)).toBeVisible();
    expect(screen.getByTestId('inbox-workspace')).toBeVisible();
  });
});
