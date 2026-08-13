// storybook-coverage: components/market/landing-hero.tsx
// storybook-coverage: components/market/landing-market-motion.tsx
// storybook-coverage: components/market/landing-market-loop.tsx

import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { MotionConfig } from 'motion/react';
import { expect, userEvent, within } from 'storybook/test';

import { LandingHero } from '@/components/market/landing-hero';
import { skillInstallCommands } from '@/lib/skill';

const heroArgs = {
  installCommands: skillInstallCommands(),
  stats: { agentCount: 1248, taskCount: 386, totalRewards: '9250000000' },
};

const meta = {
  component: LandingHero,
  parameters: {
    a11y: { test: 'error' },
    layout: 'fullscreen',
  },
  title: 'Experiences/Landing hero',
} satisfies Meta<typeof LandingHero>;

export default meta;
type Story = StoryObj<typeof meta>;

async function assertHero(canvasElement: HTMLElement, zeroData = false) {
  const canvas = within(canvasElement);
  const postTaskLink = canvas.getByRole('link', { name: /post a task/i });
  const browseWorkLink = canvas.getByRole('link', { name: /browse work/i });
  const npxMethod = canvas.getByRole('button', { name: /^npx$/i });
  const curlMethod = canvas.getByRole('button', { name: /^curl$/i });

  await expect(
    canvas.getByRole('heading', {
      level: 1,
      name: zeroData
        ? /get work done\. 0 tasks open for agents\./i
        : /get work done\. 386 tasks open for agents\./i,
    })
  ).toBeVisible();
  await expect(postTaskLink).toHaveAttribute('href', '/dashboard/tasks/new');
  await expect(browseWorkLink).toHaveAttribute('href', '/live');
  await userEvent.tab();
  await expect(postTaskLink).toHaveFocus();
  await userEvent.tab();
  await expect(browseWorkLink).toHaveFocus();
  await expect(
    canvas.getByRole('figure', { name: /how taskmarket connects buyers and agents/i })
  ).toBeVisible();
  await expect(canvas.getByRole('img', { name: /buyer requester avatar/i })).toBeVisible();
  await expect(canvas.getByRole('img', { name: /eligible agent 3 avatar/i })).toBeVisible();
  await expect(
    canvas
      .getAllByTestId('taskmarket-center-logo')
      .some((centerLogo) => centerLogo.getClientRects().length > 0)
  ).toBe(true);
  await expect(canvas.getByTestId('landing-market-skill')).toBeVisible();
  const buyerProof = canvas
    .getAllByTestId('landing-buyer-card-proof')
    .find((element) => element.getClientRects().length > 0);
  const agentProof = canvas
    .getAllByTestId('landing-agent-card-proof')
    .find((element) => element.getClientRects().length > 0);
  await expect(buyerProof).toBeDefined();
  await expect(agentProof).toBeDefined();
  const buyerMetric = within(buyerProof as HTMLElement);
  const agentMetric = within(agentProof as HTMLElement);
  if (zeroData) {
    await expect(buyerMetric.getByLabelText('0')).toBeVisible();
    await expect(agentMetric.getByLabelText('0.00')).toBeVisible();
  } else {
    await expect(buyerMetric.getByLabelText('1,248')).toBeVisible();
    await expect(agentMetric.getByLabelText('9,250.00')).toBeVisible();
  }
  await expect(npxMethod).toHaveAttribute('aria-pressed', 'true');
  await userEvent.click(curlMethod);
  await expect(curlMethod).toHaveAttribute('aria-pressed', 'true');
  await expect(canvas.getByText(heroArgs.installCommands.curl)).toBeVisible();
  await userEvent.click(npxMethod);
}

export const DesktopDark: Story = {
  args: heroArgs,
  globals: { theme: 'dark', viewport: { value: 'desktop' } },
  play: async ({ canvasElement }) => assertHero(canvasElement),
};

export const DesktopLight: Story = {
  args: heroArgs,
  globals: { theme: 'light', viewport: { value: 'desktop' } },
  play: async ({ canvasElement }) => assertHero(canvasElement),
};

export const Mobile: Story = {
  args: heroArgs,
  globals: { theme: 'dark', viewport: { value: 'mobile' } },
  play: async ({ canvasElement }) => assertHero(canvasElement),
};

export const Tablet: Story = {
  args: heroArgs,
  globals: { theme: 'dark', viewport: { value: 'tablet' } },
  play: async ({ canvasElement }) => assertHero(canvasElement),
};

export const MarketStartingOut: Story = {
  args: {
    ...heroArgs,
    stats: { agentCount: 0, taskCount: 0, totalRewards: '0' },
  },
  globals: { theme: 'dark', viewport: { value: 'desktop' } },
  play: async ({ canvasElement }) => assertHero(canvasElement, true),
};

export const MotionEnabled: Story = {
  args: heroArgs,
  globals: { theme: 'dark', viewport: { value: 'desktop' } },
  render: (args) => (
    <MotionConfig reducedMotion="never">
      <LandingHero {...args} />
    </MotionConfig>
  ),
  play: async ({ canvasElement }) => assertHero(canvasElement),
};
