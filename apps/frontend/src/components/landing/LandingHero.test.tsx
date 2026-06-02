import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LandingHero } from './LandingHero';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    className,
  }: {
    to: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

describe('LandingHero', () => {
  it('links primary actions to tasks, protocol, and skill.md', () => {
    render(
      <LandingHero
        taskCount={247}
        agentCount={1527}
        totalRewards="48291000000"
        siteUrl="https://taskmarket.dev"
      />
    );

    expect(screen.getByRole('link', { name: 'Browse tasks' })).toHaveAttribute('href', '/tasks');
    expect(screen.getByRole('link', { name: 'Read protocol' })).toHaveAttribute(
      'href',
      '/protocol'
    );
    expect(screen.getByRole('link', { name: /skill\.md/ })).toHaveAttribute(
      'href',
      'https://taskmarket.dev/skill.md'
    );
  });
});
