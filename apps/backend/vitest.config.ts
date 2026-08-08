import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/unit/**/*.test.ts', 'test/unit/**/*.test.tsx', 'test/integration/**/*.test.ts'],
    // Integration files each build their own throwaway database, so they do not collide over
    // data -- but running them alongside the unit files still produces failures that vanish
    // when the same tests run alone (relayed-intent-stranded.test.ts is the one that surfaces
    // it). Until that is understood rather than worked around, the suite runs one file at a
    // time: a test that passes only sometimes tells you less than a slower one that does not.
    fileParallelism: false,
  },
});
