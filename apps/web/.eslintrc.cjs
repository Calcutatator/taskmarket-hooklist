module.exports = {
  extends: ['@taskmarket/eslint-config'],
  env: {
    browser: true,
  },
  ignorePatterns: [
    '.next/',
    'next-env.d.ts',
    'playwright-report/',
    'storybook-static/',
    'test-results/',
  ],
};
