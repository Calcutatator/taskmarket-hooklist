import type { StorybookConfig } from '@storybook/nextjs-vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Keep Storybook builds deterministic when CI cannot reach Google Fonts. Production Next.js
// builds still download and self-host the real font; only the isolated catalogue uses this local
// response and its existing CSS fallback stack.
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
  staticDirs: ['../public'],
  stories: ['../stories/**/*.stories.@(ts|tsx)'],
  typescript: {
    reactDocgen: 'react-docgen',
  },
  viteFinal: async (viteConfig) => {
    viteConfig.resolve ??= {};
    const aliases = Array.isArray(viteConfig.resolve.alias)
      ? viteConfig.resolve.alias
      : Object.entries(viteConfig.resolve.alias ?? {}).map(([find, replacement]) => ({
          find,
          replacement,
        }));
    aliases.unshift({
      find: '@privy-io/react-auth',
      replacement: path.resolve(dirname, '../stories/mocks/privy-react-auth.tsx'),
    });
    aliases.unshift({
      find: 'viem/tempo/zones',
      replacement: path.resolve(dirname, '../stories/mocks/viem-tempo-zones.ts'),
    });
    aliases.unshift({
      find: /^viem\/tempo$/,
      replacement: path.resolve(dirname, '../stories/mocks/viem-tempo-zones.ts'),
    });
    viteConfig.resolve.alias = aliases;
    return viteConfig;
  },
};

export default config;
