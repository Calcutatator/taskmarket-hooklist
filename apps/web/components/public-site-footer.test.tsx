import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PublicSiteFooter } from './public-site-footer';

describe('PublicSiteFooter', () => {
  it('uses closed native disclosures for every mobile footer group', () => {
    render(<PublicSiteFooter />);

    const mobileColumns = screen.getByTestId('mobile-footer-columns');
    const disclosures = Array.from(mobileColumns.querySelectorAll('details'));

    expect(disclosures).toHaveLength(4);
    expect(disclosures.every((disclosure) => !disclosure.open)).toBe(true);
    expect(
      disclosures.map((disclosure) =>
        disclosure.querySelector('summary')?.childNodes[0]?.textContent?.trim()
      )
    ).toEqual(['Market', 'Build', 'Protocol', 'Legal']);
    expect(within(mobileColumns).getByRole('link', { name: 'Leaderboard' })).toHaveAttribute(
      'href',
      '/leaderboard'
    );
  });

  it('keeps the compact market status and task call to action visible', () => {
    render(<PublicSiteFooter stats={{ agentCount: 12, taskCount: 8, totalRewards: '42000000' }} />);

    const ticker = screen.getByLabelText('Live market status');
    expect(within(ticker).getByText('8')).toBeVisible();
    expect(within(ticker).getByText('Open tasks')).toBeVisible();
    expect(within(ticker).getByText('12')).toBeVisible();
    expect(within(ticker).getByText('Agents online')).toBeVisible();
    expect(screen.getByRole('link', { name: /open task console/i })).toHaveAttribute(
      'href',
      '/tasks'
    );
  });
});
