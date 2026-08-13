// storybook-coverage: components/market/burst-stages.tsx
// storybook-coverage: components/market/create-task-wizard.tsx
// storybook-coverage: components/market/hero-dotted-wave.tsx
// storybook-coverage: components/market/inbox-client.tsx
// storybook-coverage: components/market/landing-motion.tsx
// storybook-coverage: components/market/landing-typer.tsx
// storybook-coverage: components/market/landing.tsx
// storybook-coverage: components/market/live-market-pulse.tsx
// storybook-coverage: components/market/live-tetris-background.tsx
// storybook-coverage: components/market/motion/animated-number.tsx
// storybook-coverage: components/market/motion/count-up-number.tsx
// storybook-coverage: components/market/motion/countdown-timer.tsx
// storybook-coverage: components/market/motion/relative-time.tsx
// storybook-coverage: components/market/news-client.tsx
// storybook-coverage: components/market/tasks/published-celebration.tsx
// storybook-coverage: components/market/wizard/step-brief.tsx
// storybook-coverage: components/market/wizard/step-publish.tsx
// storybook-coverage: components/market/wizard/step-task-drop.tsx
// storybook-coverage: components/market/wizard/step-template.tsx
// storybook-coverage: components/market/wizard/wizard-stepper.tsx
// storybook-coverage: components/try/try-chrome.tsx
// storybook-coverage: components/try/try-drop-collage.tsx
// storybook-coverage: components/try/try-experience.tsx
// storybook-coverage: components/try/try-final-cta.tsx
// storybook-coverage: components/try/try-flow.tsx
// storybook-coverage: components/try/try-gallery.tsx
// storybook-coverage: components/try/try-hero.tsx
// storybook-coverage: components/try/try-how-it-works.tsx
// storybook-coverage: components/try/try-topic-form.tsx

import type { ActivityFeedResponse } from '@taskmarket/shared';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { MotionConfig } from 'motion/react';
import { useEffect, useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { BurstStages } from '@/components/market/burst-stages';
import { CreateTaskWizard } from '@/components/market/create-task-wizard';
import { InboxClient } from '@/components/market/inbox-client';
import { LandingPageContent } from '@/components/market/landing';
import { AnimatedNumber } from '@/components/market/motion/animated-number';
import { CountUpNumber } from '@/components/market/motion/count-up-number';
import { CountdownTimer } from '@/components/market/motion/countdown-timer';
import { RelativeTime } from '@/components/market/motion/relative-time';
import { NewsClient } from '@/components/market/news-client';
import { PublishedCelebration } from '@/components/market/tasks/published-celebration';
import { StepTemplate } from '@/components/market/wizard/step-template';
import { WizardStepper } from '@/components/market/wizard/wizard-stepper';
import { TryExperience } from '@/components/try/try-experience';
import { DEFAULT_FORM_VALUES } from '@/lib/market/create-task-form';
import { TRY_DROPS } from '@/lib/try/drops';

import { taskFixture } from './fixtures';

function ExperienceCatalog() {
  return <div>Taskmarket end-to-end component compositions</div>;
}

const meta = {
  component: ExperienceCatalog,
  parameters: { layout: 'fullscreen' },
  title: 'Experiences/Complete flows',
} satisfies Meta<typeof ExperienceCatalog>;

export default meta;
type Story = StoryObj<typeof meta>;

const TASK_DRAFT_KEY = 'taskmarket:create-task-draft:v4:default:custom';

function FreshTaskWizard({ invalidDraft = false }: { invalidDraft?: boolean }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    window.sessionStorage.removeItem(TASK_DRAFT_KEY);
    if (invalidDraft) {
      window.sessionStorage.setItem(
        TASK_DRAFT_KEY,
        JSON.stringify({
          campaignBriefState: {
            hasManualEdits: false,
            readinessConfirmations: {},
            readinessValues: {},
            tokenValues: {},
          },
          stepIndex: 0,
          values: { ...DEFAULT_FORM_VALUES, mode: 'claim', templateId: 'logo' },
          version: 4,
        })
      );
    }
    setReady(true);
    return () => window.sessionStorage.removeItem(TASK_DRAFT_KEY);
  }, [invalidDraft]);

  return ready ? <CreateTaskWizard initialMarketStats={null} /> : null;
}

const activityFeed: ActivityFeedResponse = {
  items: [
    {
      actor: '0x597b0e7F366D9f985E03C8BdaF014C96a5985e4B',
      actorType: 'agent',
      amount: '125000000',
      rating: null,
      taskId: 'task-1',
      taskTitle: 'Map the protocol onboarding experience',
      timestamp: '2026-08-02T04:00:00.000Z',
      type: 'task_created',
    },
    {
      actor: '0x2222222222222222222222222222222222222222',
      actorType: 'human',
      amount: null,
      rating: 5,
      taskId: 'task-2',
      taskTitle: 'Create a launch visual system',
      timestamp: '2026-08-02T03:15:00.000Z',
      type: 'task_rated',
    },
  ],
  nextCursor: null,
};

export const LandingWithLiveMarketData: Story = {
  parameters: { a11y: { test: 'error' } },
  render: () => (
    <LandingPageContent
      stats={{ agentCount: 1248, taskCount: 386, totalRewards: '9250000000' }}
      tasks={[
        taskFixture({ id: 'landing-1', mode: 'bounty', reward: '850000000' }),
        taskFixture({ id: 'landing-2', mode: 'claim', reward: '125000000' }),
        taskFixture({ id: 'landing-3', mode: 'benchmark', reward: '400000000' }),
      ]}
      topAgents={[]}
    />
  ),
};

export const GuidedTryExperience: Story = {
  parameters: { a11y: { test: 'error' } },
  render: () => <TryExperience drops={TRY_DROPS} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const [heroPrompt, closingPrompt] = canvas.getAllByLabelText(/what should yours explain/i);

    await expect(heroPrompt).toBeEnabled();
    await userEvent.type(heroPrompt!, 'Why heat pumps move more energy than they consume');
    await expect(closingPrompt).toHaveValue('Why heat pumps move more energy than they consume');
  },
};

export const TaskWizardDefaultAndCampaign: Story = {
  render: () => (
    <div className="mx-auto grid max-w-6xl gap-12 p-6">
      <CreateTaskWizard
        initialMarketStats={{
          activeAgents7d: 52,
          activeWorkers7d: 68,
          openTasks: 18,
          registeredWorkers: 1248,
        }}
      />
      <CreateTaskWizard
        initialMarketStats={{
          activeAgents7d: 52,
          activeWorkers7d: 68,
          openTasks: 18,
          registeredWorkers: 1248,
        }}
        lock={{
          prefillFirstToken: 'safe agent infrastructure',
          reward: '1',
          templateId: 'infographic',
        }}
        variant="campaign"
      />
    </div>
  ),
};

export const TaskWizardBriefEssentials: Story = {
  globals: { theme: 'dark' },
  parameters: { a11y: { test: 'error' } },
  render: () => (
    <div className="mx-auto max-w-3xl p-6">
      <FreshTaskWizard />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /continue to brief/i }));

    await expect(canvas.queryByRole('heading', { name: /reward and timing/i })).toBeNull();
    await expect(canvas.getByRole('spinbutton', { name: /^reward/i })).toBeVisible();
    await expect(canvas.getByRole('spinbutton', { name: /^duration/i })).toHaveValue(72);
    await expect(canvas.getByLabelText(/description/i)).toBeVisible();
    const publishingSummary = canvas.getByText(/public task.*public submissions/i);
    await expect(publishingSummary).toHaveTextContent(/public task.*public submissions/i);
    await expect(canvas.queryByRole('radiogroup', { name: /task visibility/i })).toBeNull();

    await userEvent.click(canvas.getByRole('button', { name: /change publishing visibility/i }));
    await expect(canvas.getByRole('radiogroup', { name: /task visibility/i })).toBeVisible();
    await expect(canvas.getByRole('radiogroup', { name: /submission visibility/i })).toBeVisible();
  },
};

export const TaskWizardBriefMobile: Story = {
  globals: { theme: 'dark', viewport: { value: 'mobile' } },
  parameters: { a11y: { test: 'error' } },
  render: () => (
    <div className="p-3">
      <FreshTaskWizard />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /continue to brief/i }));
    await expect(canvas.queryByRole('heading', { name: /reward and timing/i })).toBeNull();
    const publishingSummary = canvas.getByText(/public task.*public submissions/i);
    await expect(publishingSummary).toHaveTextContent(/public task.*public submissions/i);
  },
};

export const TaskWizardReplacementDialog: Story = {
  globals: { theme: 'light' },
  parameters: { a11y: { test: 'error' } },
  render: () => (
    <div className="mx-auto max-w-6xl p-6">
      <CreateTaskWizard initialMarketStats={null} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('radio', { name: /logo and brand mark/i }));
    await userEvent.click(canvas.getByRole('button', { name: /continue to brief/i }));
    await userEvent.type(canvas.getByLabelText(/brand or product name/i), 'Northstar');
    await userEvent.click(canvas.getByRole('button', { name: /^back$/i }));
    const claim = within(canvas.getByRole('radiogroup', { name: /task mode/i })).getByRole(
      'radio',
      {
        name: /claim/i,
      }
    );
    await userEvent.click(claim);
    const page = within(canvasElement.ownerDocument.body);
    await expect(page.getByRole('dialog', { name: /replace this brief/i })).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: /keep current brief/i }));
    await expect(claim).toHaveFocus();
    await userEvent.click(claim);
    await userEvent.click(page.getByRole('button', { name: /^replace brief$/i }));
    await expect(claim).toHaveAttribute('aria-checked', 'true');
  },
};

export const TaskWizardInvalidDraftRecovery: Story = {
  parameters: { a11y: { test: 'error' } },
  render: () => (
    <div className="mx-auto max-w-6xl p-6">
      <FreshTaskWizard invalidDraft />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByText(/saved template did not match its work type/i)
    ).toBeVisible();
    await expect(canvas.getByRole('radio', { name: /^start blank/i })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  },
};

export const TaskWizardReviewerAccessDisclosure: Story = {
  parameters: { a11y: { test: 'error' } },
  render: () => (
    <div className="mx-auto max-w-3xl p-6">
      <CreateTaskWizard initialMarketStats={null} />
    </div>
  ),
  play: async ({ canvasElement, userEvent }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /continue to brief/i }));
    await userEvent.click(canvas.getByRole('button', { name: /show advanced settings/i }));
    const disclosure = await canvas.findByText(/grants that address confidential access/i);
    await expect(disclosure).toHaveTextContent(/private task details and every submission/i);
    await expect(canvas.getByLabelText('Evaluator address')).toHaveAttribute(
      'aria-describedby',
      disclosure.id
    );
    await expect(canvas.getByLabelText('Dispute resolver address')).toHaveAttribute(
      'aria-describedby',
      disclosure.id
    );
  },
};

export const TaskWizardGuidedRegeneration: Story = {
  parameters: { a11y: { test: 'error' } },
  render: () => (
    <div className="mx-auto max-w-6xl p-6">
      <FreshTaskWizard />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('radio', { name: /logo and brand mark/i }));
    await userEvent.click(canvas.getByRole('button', { name: /continue to brief/i }));
    const brand = canvas.getByLabelText(/brand or product name/i);
    await userEvent.type(brand, 'Northstar');
    await userEvent.type(canvas.getByLabelText(/primary audience/i), 'Design teams');
    await userEvent.type(canvas.getByLabelText(/description/i), ' Manual requester note.');
    await userEvent.clear(brand);

    const page = within(canvasElement.ownerDocument.body);
    await expect(page.getByRole('dialog', { name: /regenerate this brief/i })).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: /keep manual edits/i }));
    await expect(brand).toHaveValue('Northstar');
  },
};

export const TaskWizardPublicReadinessGate: Story = {
  parameters: { a11y: { test: 'error' } },
  render: () => (
    <div className="mx-auto max-w-6xl p-6">
      <FreshTaskWizard />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('radio', { name: /landing-page copy/i }));
    await userEvent.click(canvas.getByRole('button', { name: /continue to brief/i }));
    await userEvent.type(
      canvas.getByLabelText(/product or service/i),
      'Northstar collaboration workspace'
    );
    await userEvent.type(canvas.getByLabelText(/target audience/i), 'Distributed design teams');
    await userEvent.type(canvas.getByLabelText(/^reward/i), '25');
    await userEvent.click(canvas.getByRole('button', { name: /continue to task drop/i }));
    await expect(canvas.getByText(/public product truth pack is required/i)).toBeVisible();

    const truthPack = canvas.getByLabelText(/public product truth pack/i);
    await userEvent.type(truthPack, 'not-a-url');
    await userEvent.type(canvas.getByLabelText(/primary call to action/i), 'Start a free trial');
    await userEvent.click(canvas.getByRole('button', { name: /continue to task drop/i }));
    await expect(canvas.getByText(/complete public url that opens without sign-in/i)).toBeVisible();

    await userEvent.clear(truthPack);
    await userEvent.type(truthPack, 'https://example.com/northstar/product-truth');
    await userEvent.click(canvas.getByRole('button', { name: /continue to task drop/i }));
    await expect(
      canvas.getByText(/confirm that this link opens without signing in/i)
    ).toBeVisible();
    await userEvent.click(canvas.getByLabelText(/confirmed this link opens without signing in/i));
    await userEvent.click(canvas.getByRole('button', { name: /continue to task drop/i }));
    await expect(canvas.getByRole('heading', { name: /choose a task drop/i })).toBeVisible();
  },
};

export const TaskWizardPrivateTemplateWarning: Story = {
  parameters: { a11y: { test: 'error' } },
  render: () => (
    <div className="mx-auto max-w-6xl p-6">
      <FreshTaskWizard />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('radio', { name: /logo and brand mark/i }));
    await userEvent.click(canvas.getByRole('button', { name: /continue to brief/i }));
    await userEvent.click(canvas.getByRole('button', { name: /change publishing visibility/i }));
    await userEvent.click(canvas.getByRole('radio', { name: /^private/i }));
    await expect(
      canvas.getByText(/this template remains public-safe.*does not hide onchain activity/i)
    ).toBeVisible();
  },
};

export const TaskWizardPublicTemplatePublishing: Story = {
  parameters: { a11y: { test: 'error' } },
  render: () => (
    <div className="mx-auto max-w-6xl p-6">
      <FreshTaskWizard />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('radio', { name: /logo and brand mark/i }));
    await userEvent.click(canvas.getByRole('button', { name: /continue to brief/i }));
    await userEvent.click(canvas.getByRole('button', { name: /change publishing visibility/i }));
    const taskVisibility = within(
      canvas.getByRole('radiogroup', { name: /task visibility/i })
    ).getByRole('radio', { name: /^public/i });
    const submissionVisibility = within(
      canvas.getByRole('radiogroup', { name: /submission visibility/i })
    ).getByRole('radio', { name: /^public/i });
    await expect(taskVisibility.getBoundingClientRect().height).toBe(
      submissionVisibility.getBoundingClientRect().height
    );
  },
};

export const TaskWizardOverlongTitle: Story = {
  parameters: { a11y: { test: 'error' } },
  render: () => (
    <div className="mx-auto max-w-6xl p-6">
      <FreshTaskWizard />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('radio', { name: /logo and brand mark/i }));
    await userEvent.click(canvas.getByRole('button', { name: /continue to brief/i }));
    await userEvent.type(canvas.getByLabelText(/brand or product name/i), 'A'.repeat(90));
    await userEvent.type(canvas.getByLabelText(/primary audience/i), 'Design teams');
    await userEvent.type(canvas.getByLabelText(/^reward/i), '25');
    await userEvent.click(canvas.getByRole('button', { name: /continue to task drop/i }));
    await expect(
      canvas.getByText(/shorten this value so the task title is 80 characters/i)
    ).toBeVisible();
    await expect(canvas.getByLabelText(/brand or product name/i)).toHaveFocus();
  },
};

export const WizardNavigationAndTemplates: Story = {
  parameters: { a11y: { test: 'error' } },
  render: () => (
    <div className="mx-auto grid max-w-6xl gap-8 p-6">
      <WizardStepper
        current={2}
        onStepClick={() => undefined}
        steps={[
          { label: 'Setup' },
          { label: 'Brief' },
          { label: 'Task Drop' },
          { label: 'Publish' },
        ]}
      />
      <StepTemplate
        mode="bounty"
        onContinue={() => undefined}
        onModeChange={() => undefined}
        onTemplateChange={() => undefined}
        templateId="logo"
      />
    </div>
  ),
};

export const MarketNewsAndDisconnectedInbox: Story = {
  render: () => (
    <div className="mx-auto grid max-w-5xl gap-10 p-6">
      <NewsClient initialFeed={activityFeed} />
      <InboxClient />
    </div>
  ),
};

export const MotionAndTimeStates: Story = {
  render: () => (
    <div className="mx-auto grid max-w-3xl gap-6 p-6 font-mono text-lg">
      <AnimatedNumber format={(value) => `${value} submissions`} value={128} />
      <CountUpNumber formatStyle="number" value={1248} />
      <CountUpNumber formatStyle="usdc-stat" value={9250} />
      <CountdownTimer source="2099-08-02T04:00:00.000Z" title="Far deadline" />
      <CountdownTimer source="2020-08-02T04:00:00.000Z" title="Expired deadline" />
      <RelativeTime value="2026-08-02T03:15:00.000Z" />
      <BurstStages />
    </div>
  ),
};

export const PublishedTaskCelebration: Story = {
  parameters: {
    nextjs: {
      navigation: {
        pathname: '/dashboard/tasks/task-1',
        query: { published: '1' },
      },
    },
  },
  render: () => (
    <div className="min-h-[600px] bg-background">
      <MotionConfig reducedMotion="never">
        <PublishedCelebration task={taskFixture()} />
      </MotionConfig>
      <div id="task-activity" />
    </div>
  ),
};
