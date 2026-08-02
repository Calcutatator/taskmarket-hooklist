// storybook-coverage: components/market/burst-stages.tsx
// storybook-coverage: components/market/create-task-wizard.tsx
// storybook-coverage: components/market/hero-dotted-wave.tsx
// storybook-coverage: components/market/inbox-client.tsx
// storybook-coverage: components/market/landing-motion.tsx
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
import { taskTemplates } from '@/lib/market/task-templates';
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
  render: () => <TryExperience drops={TRY_DROPS} />,
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

export const WizardNavigationAndTemplates: Story = {
  render: () => (
    <div className="mx-auto grid max-w-6xl gap-8 p-6">
      <WizardStepper
        current={2}
        onStepClick={() => undefined}
        steps={[
          { label: 'Template' },
          { label: 'Brief' },
          { label: 'Task Drop' },
          { label: 'Publish' },
        ]}
      />
      <StepTemplate
        applyTemplate={() => undefined}
        marketStats={{
          activeAgents7d: 52,
          activeWorkers7d: 68,
          openTasks: 18,
          registeredWorkers: 1248,
        }}
        onCustomize={() => undefined}
        onExpressPublish={() => undefined}
        templateId={taskTemplates[0].id}
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
        <PublishedCelebration />
      </MotionConfig>
      <div id="task-activity" />
    </div>
  ),
};
