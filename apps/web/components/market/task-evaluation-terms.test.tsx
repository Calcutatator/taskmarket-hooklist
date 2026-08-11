import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { TaskDetailResponse } from '@taskmarket/shared';

import { hasEvaluationTerms, TaskEvaluationTerms } from './task-evaluation-terms';

const evaluator = '0x3333333333333333333333333333333333333333';
const resolver = '0x4444444444444444444444444444444444444444';

function taskFixture(overrides: Partial<TaskDetailResponse> = {}) {
  return {
    appealDeadline: null,
    appealWindow: 172_800,
    claimedBy: null,
    disputeResolver: resolver,
    evaluationWindow: 86_400,
    evaluator,
    evaluatorDeadline: null,
    evaluatorFeeBps: 750,
    id: 'task-1',
    mode: 'bounty',
    requester: '0x1111111111111111111111111111111111111111',
    reward: '25000000',
    status: 'pending_approval',
    tags: [],
    ...overrides,
  } as unknown as TaskDetailResponse;
}

describe('hasEvaluationTerms', () => {
  it('is true once either party is appointed', () => {
    expect(hasEvaluationTerms(taskFixture())).toBe(true);
    expect(hasEvaluationTerms(taskFixture({ disputeResolver: null }))).toBe(true);
    expect(hasEvaluationTerms(taskFixture({ evaluator: null }))).toBe(true);
  });

  it('is false when neither is', () => {
    expect(hasEvaluationTerms(taskFixture({ disputeResolver: null, evaluator: null }))).toBe(false);
  });
});

describe('TaskEvaluationTerms', () => {
  // The gap this card closes: without it, nothing on task detail said an evaluator existed.
  it('renders nothing when no evaluation terms are set', () => {
    const { container } = render(
      <TaskEvaluationTerms task={taskFixture({ disputeResolver: null, evaluator: null })} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('states that the advertised reward is not what the worker receives', () => {
    render(<TaskEvaluationTerms task={taskFixture()} />);
    expect(
      screen.getByText(/payout to the worker is less than the advertised reward/)
    ).toBeVisible();
  });

  it('shows the fee as a percentage and as a USDC estimate off the reward', () => {
    render(<TaskEvaluationTerms task={taskFixture()} />);
    expect(screen.getByText('7.50%')).toBeVisible();
    // 7.5% of 25 USDC.
    expect(screen.getByText(/About 1.875 USDC of the 25 USDC reward/)).toBeVisible();
  });

  it('does not warn that the reward can move once the task has left the open status', () => {
    render(<TaskEvaluationTerms task={taskFixture()} />);
    expect(screen.queryByText(/can still change while the task is open/)).toBeNull();
  });

  // A still-open task can be updated, and an auction's price is live, so the estimate has to
  // say so rather than read as the settled amount.
  it('warns that the reward can still move while the task is open', () => {
    render(<TaskEvaluationTerms task={taskFixture({ status: 'open' })} />);
    expect(screen.getByText(/can still change while the task is open/)).toBeVisible();
  });

  it('reads a zero fee as the worker keeping the reward, not as a missing value', () => {
    render(<TaskEvaluationTerms task={taskFixture({ evaluatorFeeBps: 0 })} />);
    expect(screen.getByText('None')).toBeVisible();
    expect(screen.getByText(/full reward goes to the worker/)).toBeVisible();
  });

  // The disclosure is a claim about a worker's money on the page they decide whether to work
  // from, so it must not survive the condition that made it true.
  it('does not claim a fee reduces the payout when the evaluator charges nothing', () => {
    render(<TaskEvaluationTerms task={taskFixture({ evaluatorFeeBps: 0 })} />);
    expect(
      screen.queryByText(/payout to the worker is less than the advertised reward/)
    ).toBeNull();
    expect(screen.getByText(/charge no fee/)).toBeVisible();
  });

  describe('with a dispute resolver but no evaluator', () => {
    const resolverOnly = () => taskFixture({ evaluator: null, evaluatorFeeBps: 0 });

    it('does not say an independent evaluator judges the work', () => {
      render(<TaskEvaluationTerms task={resolverOnly()} />);
      expect(screen.queryByText(/An independent evaluator judges this work/)).toBeNull();
      expect(screen.getByText(/No evaluator is appointed/)).toBeVisible();
    });

    it('does not claim an evaluator fee comes out of the reward', () => {
      render(<TaskEvaluationTerms task={resolverOnly()} />);
      expect(
        screen.queryByText(/payout to the worker is less than the advertised reward/)
      ).toBeNull();
      expect(screen.queryByText('Evaluator fee')).toBeNull();
    });

    // Windows only exist because an evaluator owes a verdict and it can be appealed. With no
    // evaluator they describe deadlines nobody is under.
    it('omits the evaluation and appeal windows', () => {
      render(<TaskEvaluationTerms task={resolverOnly()} />);
      expect(screen.queryByText('Evaluation window')).toBeNull();
      expect(screen.queryByText('Appeal window')).toBeNull();
    });

    // It still has terms worth showing -- it just must not borrow the evaluator's copy.
    it('still renders the dispute resolver', () => {
      render(<TaskEvaluationTerms task={resolverOnly()} />);
      expect(screen.getByText('Dispute resolver')).toBeVisible();
      expect(screen.getByTitle(resolver)).toHaveTextContent('0x4444...4444');
    });

    // A non-zero fee stored on a task with no evaluator is stale data, not a deduction anyone
    // will collect, so it must not turn the disclosure back on.
    it('stays silent about a fee even when a stale bps value is set', () => {
      render(<TaskEvaluationTerms task={taskFixture({ evaluator: null, evaluatorFeeBps: 750 })} />);
      expect(
        screen.queryByText(/payout to the worker is less than the advertised reward/)
      ).toBeNull();
      expect(screen.queryByText('7.50%')).toBeNull();
    });
  });

  it('renders both windows as durations', () => {
    render(<TaskEvaluationTerms task={taskFixture()} />);
    expect(screen.getByText('1d')).toBeVisible();
    expect(screen.getByText('2d')).toBeVisible();
  });

  it('renders each deadline when the backend has computed one', () => {
    render(
      <TaskEvaluationTerms
        task={taskFixture({
          appealDeadline: '2026-08-12T10:00:00.000Z',
          evaluatorDeadline: '2026-08-10T10:00:00.000Z',
        })}
      />
    );
    expect(screen.getByText(/Verdict due/)).toBeVisible();
    expect(screen.getByText(/Appeals close/)).toBeVisible();
  });

  it('explains that a window has not started when no deadline exists yet', () => {
    render(<TaskEvaluationTerms task={taskFixture()} />);
    expect(screen.getByText('The clock starts when work is submitted.')).toBeVisible();
    expect(screen.getByText('The clock starts when the verdict is issued.')).toBeVisible();
  });

  it('falls back to a compact address for an unregistered evaluator', () => {
    render(<TaskEvaluationTerms task={taskFixture()} />);
    expect(screen.getByTitle(evaluator)).toHaveTextContent('0x3333...3333');
  });

  it('prefers a registered agent identity over raw hex', () => {
    render(<TaskEvaluationTerms evaluatorAgentId="42" task={taskFixture()} />);
    expect(screen.getByTitle(evaluator)).not.toHaveTextContent('0x3333...3333');
  });

  it('says so plainly when no dispute resolver is appointed', () => {
    render(<TaskEvaluationTerms task={taskFixture({ disputeResolver: null })} />);
    expect(screen.getByText('Not appointed')).toBeVisible();
  });

  it('links each party to its profile under the given base path', () => {
    render(<TaskEvaluationTerms profileBasePath="/agents" task={taskFixture()} />);
    expect(screen.getByTitle(evaluator)).toHaveAttribute('href', `/agents/${evaluator}`);
    expect(screen.getByTitle(resolver)).toHaveAttribute('href', `/agents/${resolver}`);
  });
});
