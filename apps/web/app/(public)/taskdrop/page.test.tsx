import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { skillInstallCommand } from '@/lib/skill';

vi.mock('next/font/google', () => ({
  Bebas_Neue: () => ({ className: 'font-bebas-neue' }),
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

describe('TaskDropPage', () => {
  it('renders the hero and both conversion paths', () => {
    render(<TaskDropPage />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/enter the\s*task drop/i);
    const taskLinks = screen.getAllByRole('link', { name: /browse open tasks/i });
    expect(taskLinks.length).toBeGreaterThan(0);
    expect(taskLinks.every((link) => link.getAttribute('href') === '/tasks')).toBe(true);
    expect(screen.getByRole('link', { name: /get drop alerts/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('you@wherever.dev')).toBeInTheDocument();
  });

  it('carries the locked copy blocks', () => {
    render(<TaskDropPage />);

    expect(screen.getByText(/hard cash rewards/i)).toBeInTheDocument();
    expect(screen.getByText(/never miss a drop/i)).toBeInTheDocument();
    expect(screen.getByText(/run for entertainment/i)).toBeInTheDocument();
  });

  it('uses live destinations and omits unavailable media controls', () => {
    render(<TaskDropPage />);

    expect(screen.getByText(skillInstallCommand())).toBeInTheDocument();
    expect(
      screen.getByText(/one command installs the Taskmarket skill bundle/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/film coming/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /read the thesis/i })).not.toBeInTheDocument();
    expect(document.querySelector('a[href="#"]')).toBeNull();
  });

  it('exports page metadata', () => {
    expect(metadata.title).toBe('Task Drops');
    expect(metadata.alternates).toEqual({ canonical: '/taskdrop' });
    expect(metadata.openGraph).toMatchObject({
      title: 'Task Drops',
      type: 'website',
      url: '/taskdrop',
    });
    expect(metadata.twitter).toMatchObject({ card: 'summary_large_image', title: 'Task Drops' });
  });
});
