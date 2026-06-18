import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { InfoTooltip } from './info-tooltip';

describe('InfoTooltip', () => {
  it('renders the wrapped label and an accessible trigger description', () => {
    render(
      <InfoTooltip label="Funds held in escrow until the deliverable is accepted.">
        Escrow tx
      </InfoTooltip>
    );

    const trigger = screen.getByRole('button', {
      name: /funds held in escrow until the deliverable is accepted/i,
    });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveTextContent('Escrow tx');
  });
});
