import type { TaskDetailResponse } from '@taskmarket/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { VerdictEvidencePanel } from './verdict-evidence-panel';

const task = {
  appealDeadline: '2026-08-08T12:00:00.000Z',
  disputeResolver: '0x3333333333333333333333333333333333333333',
  evaluator: '0x2222222222222222222222222222222222222222',
  evaluatorDeadline: '2026-08-07T12:00:00.000Z',
  id: 'task-verdict',
  verdictConfidence: 875,
  verdictEvidenceHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  verdictScore: 920,
  verdictType: 'APPROVE',
} as TaskDetailResponse;

describe('VerdictEvidencePanel', () => {
  it('shows recorded verdict metadata and decision-maker identities', () => {
    render(<VerdictEvidencePanel task={task} />);

    const region = screen.getByRole('region', { name: /verdict and decision evidence/i });
    expect(region).toHaveAttribute('id', 'task-verdict');
    expect(region).toHaveAttribute('tabindex', '-1');
    expect(region).toHaveTextContent('Approved');
    expect(region).toHaveTextContent('920 / 1000');
    expect(region).toHaveTextContent('875 / 1000');
    expect(region).toHaveTextContent(task.verdictEvidenceHash!);
    expect(region).toHaveTextContent('0x2222...2222');
    expect(region).toHaveTextContent('0x3333...3333');
    expect(region).toHaveTextContent('Appeal deadline');
  });

  it('states when no verdict metadata is available without inventing values', () => {
    render(
      <VerdictEvidencePanel
        forceVisible
        task={{
          ...task,
          appealDeadline: null,
          verdictConfidence: null,
          verdictEvidenceHash: null,
          verdictScore: null,
          verdictType: null,
        }}
      />
    );

    expect(screen.getByText(/no verdict has been recorded yet/i)).toBeVisible();
    expect(screen.getAllByText('Unavailable')).toHaveLength(1);
    expect(screen.queryByText(/\/ 1000/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^0x[a-f0-9]{64}$/i)).not.toBeInTheDocument();
  });

  it('labels partial recorded metadata as unavailable', () => {
    render(
      <VerdictEvidencePanel
        task={{
          ...task,
          verdictConfidence: null,
          verdictEvidenceHash: null,
          verdictScore: null,
        }}
      />
    );

    expect(screen.getAllByText('Approved')).toHaveLength(2);
    expect(screen.getAllByText('Unavailable')).toHaveLength(3);
    expect(screen.getByText('Score').nextElementSibling).toHaveTextContent('Unavailable');
    expect(screen.getByText('Confidence').nextElementSibling).toHaveTextContent('Unavailable');
    expect(screen.getByText('Evidence hash').nextElementSibling).toHaveTextContent('Unavailable');
  });

  it('does not reveal omitted restricted fields', () => {
    render(
      <VerdictEvidencePanel
        forceVisible
        task={{
          ...task,
          disputeResolver: null,
          evaluator: null,
          verdictEvidenceHash: null,
        }}
      />
    );

    expect(screen.queryByText('0x2222...2222')).not.toBeInTheDocument();
    expect(screen.queryByText('0x3333...3333')).not.toBeInTheDocument();
    expect(screen.queryByText(task.verdictEvidenceHash!)).not.toBeInTheDocument();
    expect(screen.getByText('Evaluator').nextElementSibling).toHaveTextContent('Unavailable');
    expect(screen.getByText('Dispute resolver').nextElementSibling).toHaveTextContent(
      'Unavailable'
    );
  });
});
