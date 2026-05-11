import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LandingPageContent } from './landing';

describe('LandingPageContent', () => {
  it('links the navbar and primary landing actions into market destinations', () => {
    const { container } = render(
      <LandingPageContent
        stats={{
          agentCount: 4,
          taskCount: 12,
          totalRewards: '25000000',
        }}
        tasks={[]}
      />
    );

    const header = container.querySelector('header');
    const primaryNav = screen.getByRole('navigation', { name: /primary/i });

    expect(header).not.toBeNull();
    expect(screen.getByRole('link', { name: /taskmarket/i })).toHaveAttribute('href', '/');
    expect(within(primaryNav).getByRole('link', { name: /^tasks$/i })).toHaveAttribute(
      'href',
      '/tasks'
    );
    expect(within(primaryNav).getByRole('link', { name: /^agents$/i })).toHaveAttribute(
      'href',
      '/agents'
    );
    expect(within(primaryNav).getByRole('link', { name: /^protocol$/i })).toHaveAttribute(
      'href',
      '/protocol'
    );
    expect(
      within(header as HTMLElement).getByRole('link', { name: /^dashboard$/i })
    ).toHaveAttribute('href', '/dashboard');
    expect(screen.getByRole('link', { name: /open dashboard/i })).toHaveAttribute(
      'href',
      '/dashboard'
    );
    expect(
      screen
        .getAllByRole('link', { name: /browse tasks/i })
        .some((link) => link.getAttribute('href') === '/dashboard/tasks')
    ).toBe(true);
    expect(
      screen.getByText('curl -fsSL https://taskmarket.example/skill.md -o skill.md')
    ).toBeVisible();
    expect(screen.getByRole('button', { name: /copy skill install command/i })).toBeVisible();
    expect(screen.queryByRole('link', { name: /read protocol/i })).not.toBeInTheDocument();
    expect(container.querySelector('[data-testid="task-market-hero-grid"]')).toHaveAttribute(
      'aria-hidden',
      'true'
    );
  });

  it('renders the landing footer with market and protocol links', () => {
    render(
      <LandingPageContent
        stats={{
          agentCount: 4,
          taskCount: 12,
          totalRewards: '25000000',
        }}
        tasks={[]}
      />
    );

    const footer = screen.getByRole('contentinfo');

    expect(within(footer).getByRole('link', { name: /browse tasks/i })).toHaveAttribute(
      'href',
      '/tasks'
    );
    expect(within(footer).getByRole('link', { name: /skill\.md/i })).toHaveAttribute(
      'href',
      '/skill.md'
    );
    expect(within(footer).getByRole('link', { name: /open task console/i })).toHaveAttribute(
      'href',
      '/dashboard/tasks'
    );
    expect(within(footer).getByText(/post work\. accept work\. settle receipts\./i)).toBeVisible();
  });
});
