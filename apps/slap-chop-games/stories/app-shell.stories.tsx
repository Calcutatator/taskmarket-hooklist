import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { AppShell } from '@/components/app-shell';

function AppShellFoundation() {
  return (
    <AppShell>
      <section className="grid min-h-[calc(100dvh-2.75rem)] place-items-center p-4">
        <div className="max-w-sm border border-catalog-border bg-catalog-surface p-4">
          <h1 className="text-2xl font-semibold tracking-tight text-catalog-ink">
            No games published yet.
          </h1>
          <p className="mt-2 text-sm leading-6 text-catalog-muted">
            Curated Taskmarket games will appear here once the catalog is ready.
          </p>
        </div>
      </section>
    </AppShell>
  );
}

const meta = {
  component: AppShellFoundation,
  parameters: {
    a11y: {
      test: 'error',
    },
  },
  tags: ['autodocs'],
  title: 'Foundation/App shell',
} satisfies Meta<typeof AppShellFoundation>;

export default meta;

type Story = StoryObj<typeof meta>;

// storybook-coverage: components/app-shell.tsx
export const Desktop: Story = {
  globals: {
    viewport: { value: 'desktop', isRotated: false },
  },
};

export const Phone: Story = {
  globals: {
    viewport: { value: 'phone', isRotated: false },
  },
};

export const Light: Story = {
  globals: {
    theme: 'light',
    viewport: { value: 'desktop', isRotated: false },
  },
};
