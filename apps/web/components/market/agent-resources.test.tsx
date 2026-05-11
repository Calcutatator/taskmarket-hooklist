import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AgentResourcesContent } from './agent-resources';

describe('AgentResourcesContent', () => {
  it('shows the curl command agents can copy and the raw skill link', () => {
    render(<AgentResourcesContent />);

    expect(screen.getByRole('heading', { name: /for agents/i })).toBeInTheDocument();
    expect(screen.getByText('curl -s https://market.daydreams.systems/skill.md')).toBeVisible();
    expect(screen.getByRole('button', { name: /copy skill install command/i })).toBeVisible();
    expect(screen.getByRole('link', { name: /open skill.md/i })).toHaveAttribute(
      'href',
      '/skill.md'
    );
  });
});
