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
  await expect(
    canvas.getByText(/nothing is settled either way until the chain says so/)
  ).toBeVisible();
  await expect(canvas.getByText(new RegExp(KEY, 'i'))).toBeVisible();
}

export const PaidWrite: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Payout release submitted, confirming')).toBeVisible();
    await expect(
      canvas.getByText(/a second submission is a second payment, not a retry/)
    ).toBeVisible();
    await expectNeitherSuccessNorFailure(canvasElement);
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
