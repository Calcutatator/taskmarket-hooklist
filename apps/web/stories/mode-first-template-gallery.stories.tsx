import type { TaskModeType } from '@taskmarket/shared';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';

import { StepTemplate } from '@/components/market/wizard/step-template';
import type { TaskTemplateSelection } from '@/lib/market/task-templates';

type GalleryHarnessProps = {
  initialMode: TaskModeType;
  initialTemplateId: TaskTemplateSelection;
  onContinue: () => void;
};

function GalleryHarness({ initialMode, initialTemplateId, onContinue }: GalleryHarnessProps) {
  const [mode, setMode] = useState(initialMode);
  const [templateId, setTemplateId] = useState(initialTemplateId);

  return (
    <main className="mx-auto w-full max-w-[90rem] p-4 sm:p-8">
      <StepTemplate
        mode={mode}
        onContinue={onContinue}
        onModeChange={(nextMode) => {
          setMode(nextMode);
          setTemplateId(null);
        }}
        onTemplateChange={setTemplateId}
        templateId={templateId}
      />
    </main>
  );
}

const meta = {
  component: GalleryHarness,
  parameters: {
    a11y: { test: 'error' },
    layout: 'fullscreen',
  },
  args: {
    initialMode: 'bounty',
    initialTemplateId: null,
    onContinue: fn(),
  },
  title: 'Market/Create task/Mode-first template gallery',
} satisfies Meta<typeof GalleryHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

export const BountyBlank: Story = {};

export const BountyTemplateSelected: Story = {
  args: {
    initialTemplateId: 'logo',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('region', { name: /work type/i })).toBeVisible();
    await expect(canvas.getByRole('heading', { name: /choose a starting point/i })).toBeVisible();
    await expect(canvas.queryByText(/labour market/i)).not.toBeInTheDocument();
    await expect(canvas.queryByText(/bounty · logo and brand mark/i)).not.toBeInTheDocument();
  },
};

export const ClaimTemplateSelected: Story = {
  args: {
    initialMode: 'claim',
    initialTemplateId: 'content-migration',
  },
};

export const PitchMobile: Story = {
  args: {
    initialMode: 'pitch',
    initialTemplateId: 'ux-ui-redesign',
  },
  globals: { theme: 'dark', viewport: { value: 'narrowMobile' } },
};

export const AuctionMechanisms: Story = {
  args: {
    initialMode: 'auction',
    initialTemplateId: 'cross-browser-qa',
  },
};

export const ExpandedTemplateDetails: Story = {
  args: {
    initialMode: 'benchmark',
    initialTemplateId: 'api-latency',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const disclosureButtons = canvas.getAllByRole('button', {
      name: /details/i,
      expanded: false,
    });
    await userEvent.click(disclosureButtons[1]);
    await expect(canvas.getByText(/latency improves under the fixed workload/i)).toBeVisible();
    disclosureButtons[1].focus();
    await userEvent.keyboard('{ArrowRight}');
    await expect(canvas.getByRole('radio', { name: /api latency optimization/i })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  },
};

export const ExpandedTemplateDetailsLight: Story = {
  ...ExpandedTemplateDetails,
  globals: { theme: 'light' },
};

export const KeyboardSelection: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const blank = canvas.getByRole('radio', { name: /start blank/i });
    blank.focus();
    await userEvent.keyboard('{ArrowRight}');
    await expect(canvas.getByRole('radio', { name: /logo and brand mark/i })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    await userEvent.keyboard('{End}');
    await expect(blank).toHaveAttribute('aria-checked', 'true');
    await userEvent.keyboard('{Home}');
    await expect(canvas.getByRole('radio', { name: /logo and brand mark/i })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    await userEvent.click(canvas.getByRole('button', { name: /continue to brief/i }));
    await expect(args.onContinue).toHaveBeenCalled();
  },
};

export const NarrowMobileBoundary: Story = {
  args: {
    initialMode: 'auction',
    initialTemplateId: 'data-labeling',
  },
  globals: { viewport: { value: 'narrowMobile' } },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(
      canvasElement.ownerDocument.documentElement.clientWidth
    );
  },
};
