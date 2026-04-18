import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'test-*.spec.ts',
  use: {
    headless: true,
    browserName: 'chromium',
  },
  timeout: 60000,
});
