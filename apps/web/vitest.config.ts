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
      '@taskmarket/html-sandbox': path.resolve(
        __dirname,
        '../../packages/html-sandbox/src/index.ts'
      ),
      '@': __dirname,
      '@taskmarket/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  test: {
    exclude: [...configDefaults.exclude, 'e2e/**'],
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    // 30s, not because any test is slow -- the slowest here runs in about 1.3s in isolation --
    // but because vitest forks per test file, and a fully parallel run on a busy machine starves
    // individual workers badly enough to cross a 15s deadline. The symptom was a timeout on a
    // different, unrelated test file every run, each of which passes on its own.
    //
    // A deadline is the wrong tool for catching a slow test anyway: it fires on whichever test
    // happened to be scheduled during the squeeze, not on the one that got slower. So this is
    // set for the slowest machine that has to pass, and capping fork concurrency was considered
    // and rejected -- it would cost wall-clock on CI, which does not have this problem.
    testTimeout: 30_000,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          // Implements: ADR-0102
          // The working-URL navigation mock is unit-only: the Storybook project below loads the
          // base setup too, and @storybook/nextjs-vite supplies its own Next navigation mocks
          // that a full replacement would clobber.
          setupFiles: ['./test/setup.ts', './test/setup-url.ts'],
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
