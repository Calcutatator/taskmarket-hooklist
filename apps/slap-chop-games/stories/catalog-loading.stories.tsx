import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { CatalogLoading } from '@/components/catalog-loading';

const meta = {
  component: CatalogLoading,
  parameters: {
    a11y: {
      test: 'error',
    },
  },
  tags: ['autodocs'],
  title: 'Catalog/Catalog loading',
} satisfies Meta<typeof CatalogLoading>;

export default meta;

type Story = StoryObj<typeof meta>;

// storybook-coverage: components/catalog-loading.tsx
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
