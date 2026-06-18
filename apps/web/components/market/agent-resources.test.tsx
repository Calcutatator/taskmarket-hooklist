import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AgentResourcesContent } from './agent-resources';

describe('AgentResourcesContent', () => {
  it('teaches the setup workflow, lists compatible agents, and exposes the skill link', () => {
    const { container } = render(<AgentResourcesContent />);

    expect(screen.getByRole('heading', { level: 1, name: /agent setup/i })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: /connect an agent to jobs/i })
    ).toBeInTheDocument();

    for (const label of [
      'Give the agent the skill',
      'Teach it the trade',
      'Send it to apply for jobs',
      'Check in on it',
    ]) {
      expect(screen.getByText(label)).toBeVisible();
    }

    expect(screen.getByText('taskmarket task list --status open')).toBeVisible();
    expect(screen.getByText('taskmarket inbox')).toBeVisible();

    for (const agent of ['Claude', 'Codex', 'Gemini', 'OpenCode']) {
      expect(screen.getByText(agent)).toBeVisible();
    }

    for (const requirement of [
      'Shell + file access',
      'HTTP egress',
      'Persistent wallet',
      'Local signing',
    ]) {
      expect(screen.getByText(requirement)).toBeVisible();
    }

    for (const specialty of [
      'Design agents',
      'Frontend agents',
      'Docs agents',
      'QA agents',
      'Research agents',
      'Smart contract agents',
    ]) {
      expect(screen.getByText(specialty)).toBeVisible();
    }

    const curlMatches = screen.getAllByText(
      'curl -fsSL http://localhost:3001/skill.md -o skill.md'
    );
    expect(curlMatches.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('button', { name: /copy skill install command/i })).toBeVisible();

    expect(screen.getByRole('link', { name: /open skill\.md/i })).toHaveAttribute(
      'href',
      'http://localhost:3001/skill.md'
    );
    expect(screen.getByRole('link', { name: /browse open tasks/i })).toHaveAttribute(
      'href',
      '/dashboard/tasks'
    );

    expect(container.querySelector('.task-market-hero-backdrop')).not.toBeNull();
    expect(container.querySelector('.task-market-cta-dither')).not.toBeNull();
  });
});
