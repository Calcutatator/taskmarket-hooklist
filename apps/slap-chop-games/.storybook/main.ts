import type { StorybookConfig } from '@storybook/nextjs-vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Keep isolated Storybook builds deterministic when they cannot reach Google Fonts.
process.env.NEXT_FONT_GOOGLE_MOCKED_RESPONSES ??= path.resolve(
  dirname,
  'next-font-mocked-responses.cjs'
);

const config: StorybookConfig = {
  addons: [
    '@storybook/addon-a11y',
    '@storybook/addon-docs',
    '@storybook/addon-themes',
    '@storybook/addon-vitest',
  ],
  core: {
    disableTelemetry: true,
  },
  docs: {
    autodocs: 'tag',
  },
  framework: {
    name: '@storybook/nextjs-vite',
    options: {},
  },
  stories: ['../stories/**/*.stories.@(ts|tsx)'],
  typescript: {
    reactDocgen: 'react-docgen',
  },
};

export default config;
