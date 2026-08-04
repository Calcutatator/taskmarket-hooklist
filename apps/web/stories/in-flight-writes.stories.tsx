// storybook-coverage: components/market/in-flight-write-notice.tsx

import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';

import { InFlightWriteNotice } from '@/components/market/in-flight-write-notice';

/**
 * The third outcome of a paid write, reviewable on its own.
 *
 * Every action in `COMPONENT_BY_ACTION` and the create-task wizard render this exact component
 * when their write comes back in flight, so the per-surface differences are entirely the
 * `title`, `subject` and `paid` props enumerated here. Reviewing this file reviews all of them.
 */
function InFlightCatalog() {
  return <div>Taskmarket in-flight paid writes</div>;
}

const meta = {
  component: InFlightCatalog,
  parameters: {
    a11y: { test: 'error' },
  },
  title: 'Product/In-flight writes',
} satisfies Meta<typeof InFlightCatalog>;

export default meta;
type Story = StoryObj<typeof meta>;

// Fixed so the reference line renders identically on every run; a random UUID would make the
// browser story tests non-deterministic on a visual diff.
const KEY = '9f1c0f6e-3a41-4c0d-9d3a-0f1c9f1c0f6e';

/** The assertion the whole feature exists for: an in-flight state offers nothing to press. */
async function expectNoRetryControl(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  // Not "no button labelled retry" -- no interactive control at all. A user must not be able
  // to resubmit a paid action from here, and the absence of the control is the mechanism.
  await expect(canvas.queryByRole('button')).toBeNull();
  await expect(canvas.queryByRole('link')).toBeNull();
  await expect(canvas.queryByRole('textbox')).toBeNull();
}

async function expectNeitherSuccessNorFailure(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await expect(canvas.getByText(/not a success and not a failure/)).toBeVisible();
  await expect(canvas.getByText(/nothing is settled either way until it lands/)).toBeVisible();
  await expect(canvas.getByText(new RegExp(KEY, 'i'))).toBeVisible();
}

// The copy describes the state, never the machinery under it. A user waiting on a submission
// does not care where it is confirming, and naming the mechanism would put implementation into
// a sentence whose whole job is to say what is true right now.
async function expectNoMechanismInCopy(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await expect(canvas.queryByText(/on.chain/i)).toBeNull();
  await expect(canvas.queryByText(/blockchain/i)).toBeNull();
}

export const PaidWrite: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Payout release submitted, confirming')).toBeVisible();
    await expect(
      canvas.getByText(/a second submission is a second payment, not a retry/)
    ).toBeVisible();
    await expectNeitherSuccessNorFailure(canvasElement);
    await expectNoMechanismInCopy(canvasElement);
    await expectNoRetryControl(canvasElement);
  },
  render: () => (
    <InFlightWriteNotice
      idempotencyKey={KEY}
      subject="payout release"
      title="Payout release submitted, confirming"
    />
  ),
};

/**
 * Polling has run its course. The copy gets more honest, not more hopeful, and it still offers
 * no control -- "wait longer" and "try again" are different claims and only the first is true.
 */
export const PaidWriteStalled: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/Still not settled/)).toBeVisible();
    await expect(canvas.getByText(/Do not submit the rating again/)).toBeVisible();
    await expectNoRetryControl(canvasElement);
  },
  render: () => (
    <InFlightWriteNotice
      idempotencyKey={KEY}
      stalled
      subject="rating"
      title="Rating submitted, confirming"
    />
  ),
};

/**
 * A relayed but unpaid write (claim, forfeit, winner and worker selection). Resubmitting costs
 * nothing here, so the copy says what is actually true rather than borrowing the paid warning.
 */
export const UnpaidRelayedWrite: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Claim submitted, confirming')).toBeVisible();
    await expect(
      canvas.getByText(/a second submission is a second write rather than a retry/)
    ).toBeVisible();
    await expect(canvas.queryByText(/second payment/)).toBeNull();
    await expectNoRetryControl(canvasElement);
  },
  render: () => (
    <InFlightWriteNotice
      idempotencyKey={KEY}
      paid={false}
      subject="claim"
      title="Claim submitted, confirming"
    />
  ),
};

/** The create-task wizard: the most expensive one, because the escrowed reward is the payment. */
export const TaskCreation: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Task submitted, confirming')).toBeVisible();
    await expectNeitherSuccessNorFailure(canvasElement);
    await expectNoRetryControl(canvasElement);
  },
  render: () => (
    <InFlightWriteNotice idempotencyKey={KEY} subject="task" title="Task submitted, confirming" />
  ),
};

// Storybook 10 reads the viewport from globals; `parameters.viewport.defaultViewport` is the
// pre-9 form and is silently ignored, so a story using it renders at desktop width regardless.
export const PaidWriteMobile: Story = {
  globals: { viewport: { value: 'mobile' } },
  play: async ({ canvasElement }) => {
    // The reference is a UUID with no spaces, so `break-all` is what keeps it from forcing the
    // card wider than a phone. Worth an assertion because the failure is silent horizontal
    // overflow rather than an error.
    const canvas = within(canvasElement);
    await expect(canvas.getByText(new RegExp(KEY, 'i'))).toBeVisible();
    await expectNoRetryControl(canvasElement);
  },
  render: () => (
    <InFlightWriteNotice
      idempotencyKey={KEY}
      stalled
      subject="payout release"
      title="Payout release submitted, confirming"
    />
  ),
};

export const PaidWriteDark: Story = {
  globals: { theme: 'dark' },
  play: async ({ canvasElement }) => {
    await expectNeitherSuccessNorFailure(canvasElement);
    await expectNoRetryControl(canvasElement);
  },
  render: () => (
    <InFlightWriteNotice
      idempotencyKey={KEY}
      subject="submission"
      title="Submission submitted, confirming"
    />
  ),
};

export const PaidWriteLight: Story = {
  globals: { theme: 'light' },
  play: async ({ canvasElement }) => {
    await expectNeitherSuccessNorFailure(canvasElement);
    await expectNoRetryControl(canvasElement);
  },
  render: () => (
    <InFlightWriteNotice
      idempotencyKey={KEY}
      subject="submission"
      title="Submission submitted, confirming"
    />
  ),
};

export const PaidWriteDarkMobile: Story = {
  globals: { theme: 'dark', viewport: { value: 'mobile' } },
  play: async ({ canvasElement }) => {
    await expectNoRetryControl(canvasElement);
  },
  render: () => (
    <InFlightWriteNotice
      idempotencyKey={KEY}
      stalled
      subject="task"
      title="Task submitted, confirming"
    />
  ),
};

/**
 * Every surface's copy side by side. The point of the comparison is that there is one
 * vocabulary: same heading shape, same body, same reference line, no control anywhere.
 */
export const EverySurface: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByText(/not a success and not a failure/)).toHaveLength(17);
    await expectNoRetryControl(canvasElement);
  },
  render: () => (
    <div className="grid max-w-2xl gap-3">
      {(
        [
          ['Payout release submitted, confirming', 'payout release', true],
          ['Auction acceptance submitted, confirming', 'auction acceptance', true],
          ['Bid submitted, confirming', 'bid', true],
          ['Cancellation submitted, confirming', 'cancellation', true],
          ['Appointment submitted, confirming', 'appointment', true],
          ['Escrow recovery submitted, confirming', 'escrow recovery', true],
          ['Pitch submitted, confirming', 'pitch', true],
          ['Proof submitted, confirming', 'proof', true],
          ['Rating submitted, confirming', 'rating', true],
          ['Rejection submitted, confirming', 'rejection', true],
          ['Submission submitted, confirming', 'submission', true],
          ['Update submitted, confirming', 'update', true],
          ['Task submitted, confirming', 'task', true],
          ['Claim submitted, confirming', 'claim', false],
          ['Forfeit submitted, confirming', 'forfeit', false],
          ['Winner selection submitted, confirming', 'winner selection', false],
          ['Worker selection submitted, confirming', 'worker selection', false],
        ] as const
      ).map(([title, subject, paid]) => (
        <InFlightWriteNotice
          idempotencyKey={KEY}
          key={title}
          paid={paid}
          subject={subject}
          title={title}
        />
      ))}
    </div>
  ),
};

// ---------------------------------------------------------------------------
// Settled failures, read from the intent (ADR-0049's `intents.get`).
//
// These are what the waiting states above turn into once the write is known to have failed.
// Before the intent read existed the page could only keep saying "not yet" until it gave up,
// so every story below is a state a user previously could not be shown at all.
// ---------------------------------------------------------------------------

/** The shared assertions for any failed state: it is definite, and it still offers nothing. */
async function expectSettledFailure(canvasElement: HTMLElement, subject: string) {
  const canvas = within(canvasElement);
  await expect(canvas.getByText(`The ${subject} did not go through`)).toBeVisible();
  await expect(canvas.getByText(/definitively failed/)).toBeVisible();
  // The waiting copy must be gone rather than sitting alongside the verdict.
  await expect(canvas.queryByText(/not a success and not a failure/)).toBeNull();
  await expectNoMechanismInCopy(canvasElement);
  await expectNoRetryControl(canvasElement);
}

/** Money back. The only state that closes the interaction with nothing left to do. */
export const FailedRefunded: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/Your payment has been returned/)).toBeVisible();
    await expect(canvas.getByText(/Reason: escrow deposit reverted/)).toBeVisible();
    await expectSettledFailure(canvasElement, 'task');
  },
  render: () => (
    <InFlightWriteNotice
      failure={{
        reason: 'escrow deposit reverted',
        refund: { status: 'refunded', txHash: '0xabc' },
      }}
      idempotencyKey={KEY}
      subject="task"
      title="Task submitted, confirming"
    />
  ),
};

/** Money on its way back. Says wait, and says explicitly that waiting is all that is needed. */
export const FailedRefundInProgress: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/on its way back/)).toBeVisible();
    await expect(canvas.getByText(/Nothing further is needed from you/)).toBeVisible();
    await expectSettledFailure(canvasElement, 'rating');
  },
  render: () => (
    <InFlightWriteNotice
      failure={{ reason: 'rating window closed', refund: { status: 'refunding', txHash: null } }}
      idempotencyKey={KEY}
      subject="rating"
      title="Rating submitted, confirming"
    />
  ),
};

/**
 * The refund itself failed. The single state where a user must escalate rather than wait, and
 * the one that disappears if the refund states are flattened into "not refunded".
 */
export const FailedRefundStuck: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/could not be returned automatically/)).toBeVisible();
    await expect(canvas.getByText(/will not resolve on its own/)).toBeVisible();
    await expect(canvas.getByText(/Quote the reference below to support/)).toBeVisible();
    await expect(canvas.queryByText(/Nothing further is needed/)).toBeNull();
    await expectSettledFailure(canvasElement, 'pitch');
  },
  render: () => (
    <InFlightWriteNotice
      failure={{
        reason: 'relay exhausted its attempts',
        refund: { status: 'failed', txHash: null },
      }}
      idempotencyKey={KEY}
      subject="pitch"
      title="Pitch submitted, confirming"
    />
  ),
};

/**
 * Paid, failed, and no refund decided yet. Silence here would read as "no refund is coming",
 * which is a claim the intent has not made.
 */
export const FailedRefundUndecided: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText(/No decision about your payment has been recorded yet/)
    ).toBeVisible();
    await expectSettledFailure(canvasElement, 'submission');
  },
  render: () => (
    <InFlightWriteNotice
      failure={{ reason: null, refund: null }}
      idempotencyKey={KEY}
      subject="submission"
      title="Submission submitted, confirming"
    />
  ),
};

/**
 * A free relayed write that failed. Nothing was taken, so nothing is said about money -- "not
 * returned" would describe a payment that never happened.
 */
export const FailedUnpaidWrite: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText(/payment/i)).toBeNull();
    await expect(canvas.queryByText(/returned/i)).toBeNull();
    await expectSettledFailure(canvasElement, 'claim');
  },
  render: () => (
    <InFlightWriteNotice
      failure={{ reason: 'task was already claimed', refund: null }}
      idempotencyKey={KEY}
      paid={false}
      subject="claim"
      title="Claim submitted, confirming"
    />
  ),
};

export const FailedRefundStuckDark: Story = {
  globals: { theme: 'dark' },
  play: async ({ canvasElement }) => {
    await expectSettledFailure(canvasElement, 'pitch');
  },
  render: () => (
    <InFlightWriteNotice
      failure={{
        reason: 'relay exhausted its attempts',
        refund: { status: 'failed', txHash: null },
      }}
      idempotencyKey={KEY}
      subject="pitch"
      title="Pitch submitted, confirming"
    />
  ),
};

export const FailedRefundStuckLight: Story = {
  globals: { theme: 'light' },
  play: async ({ canvasElement }) => {
    await expectSettledFailure(canvasElement, 'pitch');
  },
  render: () => (
    <InFlightWriteNotice
      failure={{
        reason: 'relay exhausted its attempts',
        refund: { status: 'failed', txHash: null },
      }}
      idempotencyKey={KEY}
      subject="pitch"
      title="Pitch submitted, confirming"
    />
  ),
};

/**
 * A long terminal reason on a phone. The reason comes from the backend verbatim, so it has no
 * length the component controls -- `break-words` is what keeps it from overflowing sideways.
 */
export const FailedLongReasonMobile: Story = {
  globals: { viewport: { value: 'mobile' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/Reason: execution reverted/)).toBeVisible();
    await expectSettledFailure(canvasElement, 'task');
  },
  render: () => (
    <InFlightWriteNotice
      failure={{
        reason:
          'execution reverted: TaskNotOpen(0x9f1c0f6e3a414c0d9d3a0f1c9f1c0f6e3a414c0d9d3a0f1c9f1c0f6e3a414c0d)',
        refund: { status: 'refunded', txHash: '0xabc' },
      }}
      idempotencyKey={KEY}
      subject="task"
      title="Task submitted, confirming"
    />
  ),
};

export const FailedRefundStuckDarkMobile: Story = {
  globals: { theme: 'dark', viewport: { value: 'mobile' } },
  play: async ({ canvasElement }) => {
    await expectSettledFailure(canvasElement, 'pitch');
  },
  render: () => (
    <InFlightWriteNotice
      failure={{
        reason: 'relay exhausted its attempts',
        refund: { status: 'failed', txHash: null },
      }}
      idempotencyKey={KEY}
      subject="pitch"
      title="Pitch submitted, confirming"
    />
  ),
};

/**
 * Every refund answer side by side. The comparison is the point: each one tells the user
 * something different to do, and none of them is a control to press.
 */
export const EveryRefundState: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByText(/did not go through/)).toHaveLength(5);
    await expect(canvas.getAllByText(/Quote the reference below to support/)).toHaveLength(2);
    await expectNoRetryControl(canvasElement);
  },
  render: () => (
    <div className="grid max-w-2xl gap-3">
      {(
        [
          ['refunded', { status: 'refunded', txHash: '0xabc' }, true],
          ['refunding', { status: 'refunding', txHash: null }, true],
          ['pending', { status: 'pending', txHash: null }, true],
          ['failed', { status: 'failed', txHash: null }, true],
          // Paid, with no refund decided yet -- the open question, not the free write.
          ['undecided', null, true],
        ] as const
      ).map(([label, refund, paid]) => (
        <InFlightWriteNotice
          failure={{ reason: `refund state: ${label}`, refund }}
          idempotencyKey={KEY}
          key={label}
          paid={paid}
          subject="submission"
          title="Submission submitted, confirming"
        />
      ))}
    </div>
  ),
};
