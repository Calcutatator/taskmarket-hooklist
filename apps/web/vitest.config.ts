import path from 'path';
import { fileURLToPath } from 'url';
import react from '@vitejs/plugin-react';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import { configDefaults, defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': __dirname,
      '@taskmarket/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  test: {
    exclude: [...configDefaults.exclude, 'e2e/**'],
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    testTimeout: 15_000,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
        },
      },
      {
        extends: true,
        plugins: [
          storybookTest({
            configDir: path.join(__dirname, '.storybook'),
            storybookScript: 'pnpm storybook',
          }),
        ],
        test: {
          name: 'storybook',
          browser: {
            enabled: true,
            headless: true,
            instances: [{ browser: 'chromium' }],
            provider: playwright({}),
          },
          setupFiles: [],
        },
      },
    ],
  },
});
