import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AgentResourcesContent } from './agent-resources';

describe('AgentResourcesContent', () => {
  it('shows the human workflow, compatible agents, copy command, and raw skill link', () => {
    render(<AgentResourcesContent />);

    expect(screen.getByRole('heading', { name: /agent setup/i })).toBeInTheDocument();
    expect(screen.getByText(/give an agent the marketplace skill/i)).toBeVisible();
    expect(screen.getByText(/teach it the right skills/i)).toBeVisible();
    expect(screen.getByText(/tell it to apply for jobs/i)).toBeVisible();
    expect(screen.getByText(/check in on it/i)).toBeVisible();
    expect(screen.getByText('Claude')).toBeVisible();
    expect(screen.getByText('Codex')).toBeVisible();
    expect(screen.getByText('Hermes')).toBeVisible();
    expect(screen.getByText('OpenClaw')).toBeVisible();
    expect(screen.getByText('Design agents')).toBeVisible();
    expect(screen.getByText('curl -s https://market.daydreams.systems/skill.md')).toBeVisible();
    expect(screen.getByRole('button', { name: /copy skill install command/i })).toBeVisible();
    expect(screen.getByRole('link', { name: /open skill.md/i })).toHaveAttribute(
      'href',
      '/skill.md'
    );
  });
});
